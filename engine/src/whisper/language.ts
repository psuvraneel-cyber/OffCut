import { Tensor } from "@huggingface/transformers";

export interface GenerationConfigLike {
  decoder_start_token_id?: number;
  lang_to_id?: Record<string, number>;
  is_multilingual?: boolean;
}

export interface ModelLike {
  generation_config?: GenerationConfigLike;
  config?: {
    decoder_start_token_id?: number;
    is_multilingual?: boolean;
  };
  forward?: (inputs: Record<string, unknown>) => Promise<{
    logits?: Tensor | { dims?: number[]; data?: ArrayLike<number> };
  }>;
  generate?: (options: Record<string, unknown>) => Promise<unknown>;
}

export interface ProcessorLike {
  (audio: Float32Array): Promise<{ input_features: Tensor }>;
}

export interface PipelineLike {
  model?: ModelLike;
  processor?: ProcessorLike;
}

export function cleanLanguageCode(token: string): string {
  const match = token.match(/^<\|?([a-zA-Z]+)\|?>?$/);
  if (match) {
    return match[1].toLowerCase();
  }
  return token.replace(/^[<|]+/, "").replace(/[|>]+$/, "").toLowerCase();
}

export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function selectDetectionWindowIndex(rmsValues: readonly number[]): number {
  const limit = Math.min(3, rmsValues.length);
  for (let index = 0; index < limit; index += 1) {
    if (rmsValues[index] >= 0.01) {
      return index;
    }
  }
  return 0;
}

export function findBestLanguage(
  logits: ArrayLike<number | bigint>,
  langToId: Record<string, number>,
  offset = 0,
  candidates?: readonly string[],
): string | null {
  let bestLang: string | null = null;
  let maxScore = -Infinity;

  for (const [token, id] of Object.entries(langToId)) {
    const lang = cleanLanguageCode(token);
    if (candidates && candidates.length > 0 && !candidates.includes(lang)) {
      continue;
    }

    const index = offset + id;
    if (index >= 0 && index < logits.length) {
      const rawScore = logits[index];
      const score = typeof rawScore === "bigint" ? Number(rawScore) : rawScore;
      if (score > maxScore) {
        maxScore = score;
        bestLang = lang;
      }
    }
  }

  return bestLang;
}

/**
 * Coerces Indian subcontinent languages with high acoustic overlap with spoken Hindi
 * (such as Urdu, Marathi, Nepali, Punjabi) into "hi" to prevent Perso-Arabic / Urdu script drift.
 */
export function coerceHindustaniLanguage(detected: string): string {
  const normalized = detected.toLowerCase();
  if (normalized === "ur" || normalized === "mr" || normalized === "ne" || normalized === "pa" || normalized === "gu") {
    return "hi";
  }
  return normalized;
}

export function parseGeneratedLanguageToken(
  output: unknown,
  langToId: Record<string, number>,
): string | null {
  if (!output) {
    return null;
  }

  const candidate = output as {
    sequences?: { tolist?: () => number[][]; data?: ArrayLike<number | bigint> };
    tolist?: () => number[][];
    data?: ArrayLike<number | bigint>;
  };

  let tokens: ArrayLike<number | bigint> | null = null;
  if (candidate.sequences?.tolist) {
    const list = candidate.sequences.tolist();
    tokens = list[0] ?? null;
  } else if (candidate.sequences?.data) {
    tokens = candidate.sequences.data;
  } else if (candidate.tolist) {
    const list = candidate.tolist();
    tokens = list[0] ?? null;
  } else if (candidate.data) {
    tokens = candidate.data;
  }

  if (!tokens || tokens.length === 0) {
    return null;
  }

  const idToLang = new Map<number, string>();
  for (const [token, id] of Object.entries(langToId)) {
    idToLang.set(Number(id), cleanLanguageCode(token));
  }

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const tokenId = Number(tokens[index]);
    const lang = idToLang.get(tokenId);
    if (lang) {
      return lang;
    }
  }

  return null;
}

export async function detectLanguage(
  pipeline: unknown,
  audio: Float32Array,
  options: { candidates?: readonly string[]; coerceHindustani?: boolean } = {},
): Promise<string> {
  const pipe = pipeline as PipelineLike;
  const model = pipe?.model;
  const processor = pipe?.processor;

  if (!model || typeof processor !== "function") {
    return "en";
  }

  const generationConfig = model.generation_config ?? {};
  const isMultilingual = generationConfig.is_multilingual ?? model.config?.is_multilingual ?? true;
  if (!isMultilingual) {
    return "en";
  }

  const langToId = generationConfig.lang_to_id;
  if (!langToId || Object.keys(langToId).length === 0) {
    return "en";
  }

  const decoderStartTokenId =
    generationConfig.decoder_start_token_id ?? model.config?.decoder_start_token_id ?? 50258;

  let inputFeatures: Tensor;
  try {
    const features = await processor(audio);
    inputFeatures = features.input_features;
  } catch (error) {
    console.warn("Language detection feature extraction failed, falling back to 'en':", error);
    return "en";
  }

  // Preferred method: direct forward pass with <|startoftranscript|> token
  if (typeof model.forward === "function") {
    try {
      const decoderInputIds = new Tensor("int64", [BigInt(decoderStartTokenId)], [1, 1]);
      const outputs = await model.forward({
        input_features: inputFeatures,
        decoder_input_ids: decoderInputIds,
      });

      const logits = outputs.logits;
      if (logits && logits.data) {
        const dims = (logits as { dims?: number[] }).dims ?? [1, 1, logits.data.length];
        const seqLen = dims[1] ?? 1;
        const vocabSize = dims[2] ?? Math.floor(logits.data.length / seqLen);
        const lastTokenOffset = (seqLen - 1) * vocabSize;
        const detected = findBestLanguage(logits.data, langToId, lastTokenOffset, options.candidates);
        if (detected) {
          return options.coerceHindustani !== false ? coerceHindustaniLanguage(detected) : detected;
        }
      }
    } catch (forwardError) {
      console.warn("Language detection forward pass failed, falling back to generate:", forwardError);
    }
  }

  // Fallback method: model.generate with max_new_tokens: 1
  if (typeof model.generate === "function") {
    try {
      const output = await model.generate({
        inputs: inputFeatures,
        decoder_input_ids: [decoderStartTokenId],
        max_new_tokens: 1,
      });
      const detected = parseGeneratedLanguageToken(output, langToId);
      if (detected) {
        return options.coerceHindustani !== false ? coerceHindustaniLanguage(detected) : detected;
      }
    } catch (generateError) {
      console.warn("Language detection generate fallback failed:", generateError);
    }
  }

  return "en";
}
