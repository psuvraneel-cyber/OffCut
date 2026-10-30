export const BENCHMARK_SCHEMA_VERSION = "2.0.0";
export const SCORING_METHODOLOGY_VERSION = "2.0.0";

export const SCORING_CONSTANTS = {
  maxFullMatrixElements: 25_000_000,
} as const;

export type OutputProfile =
  | "english_latin"
  | "hindi_devanagari"
  | "hinglish_roman"
  | "hinglish_mixed_verbatim"
  | "hinglish_script_normalized"
  | "mixed_diagnostic"
  | "raw_diagnostic";

export type ReferenceScript =
  | "latin"
  | "devanagari"
  | "mixed"
  | "romanized_hinglish";

export interface ScriptBreakdown {
  devanagariChars: number;
  latinChars: number;
  persoArabicChars: number;
  otherChars: number;
  totalLetters: number;
  replacementChars: number;
  suspiciousMarks: number;
  dominantScript: "devanagari" | "latin" | "perso_arabic" | "mixed" | "other" | "none";
  expectedScriptMatchRate: number;
  hasCorruptedUnicode: boolean;
}

export interface WordErrors {
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
  wer: number;
}

export interface DetailedWordErrors extends WordErrors {
  deletionRate: number;
  insertionRate: number;
  substitutionRate: number;
  accuracy: number;
}

export interface CharErrors {
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceChars: number;
  cer: number;
}

export interface DetailedCharErrors extends CharErrors {
  graphemeErrors?: CharErrors;
}

export interface SampleEvaluation {
  wordErrors: DetailedWordErrors;
  charErrors: DetailedCharErrors;
  scriptDiagnostics: ScriptBreakdown;
  normalizedReference: string;
  normalizedHypothesis: string;
  profile: OutputProfile;
}

interface AlignmentCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
}

/**
 * Script analysis: evaluates character distributions, detected script mix,
 * Unicode corruption (U+FFFD), and unrendered combining marks.
 */
export function analyzeScript(text: string, profile: OutputProfile = "english_latin"): ScriptBreakdown {
  const norm = text.normalize("NFC");
  const devaPattern = /[\u0900-\u097F]/;
  const latnPattern = /[a-zA-Z]/;
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  const replacementRegex = /\uFFFD/g;
  const danglingMatraRegex = /(?:^|\s)[\u093E-\u094C\u094F\u0955-\u0957]/g;

  let devanagariChars = 0;
  let latinChars = 0;
  let persoArabicChars = 0;
  let otherChars = 0;

  for (const char of norm) {
    if (devaPattern.test(char)) {
      devanagariChars++;
    } else if (latnPattern.test(char)) {
      latinChars++;
    } else if (arabicPattern.test(char)) {
      persoArabicChars++;
    } else if (/\p{L}/u.test(char)) {
      otherChars++;
    }
  }

  const replacementChars = (norm.match(replacementRegex) || []).length;
  const suspiciousMarks = (norm.match(danglingMatraRegex) || []).length;

  const totalLetters = devanagariChars + latinChars + persoArabicChars + otherChars;

  let dominantScript: ScriptBreakdown["dominantScript"] = "none";
  if (totalLetters > 0) {
    const devaRatio = devanagariChars / totalLetters;
    const latnRatio = latinChars / totalLetters;
    const arabRatio = persoArabicChars / totalLetters;

    if (devaRatio >= 0.7) {
      dominantScript = "devanagari";
    } else if (latnRatio >= 0.7) {
      dominantScript = "latin";
    } else if (arabRatio >= 0.7) {
      dominantScript = "perso_arabic";
    } else if (devanagariChars > 0 && latinChars > 0) {
      dominantScript = "mixed";
    } else if (arabRatio > 0.3) {
      dominantScript = "perso_arabic";
    } else {
      dominantScript = "other";
    }
  }

  let expectedScriptMatchRate = 1.0;
  if (totalLetters > 0) {
    if (profile === "hinglish_roman" || profile === "english_latin") {
      expectedScriptMatchRate = latinChars / totalLetters;
    } else if (profile === "hindi_devanagari") {
      expectedScriptMatchRate = (devanagariChars + latinChars) / totalLetters;
    } else if (profile === "mixed_diagnostic") {
      expectedScriptMatchRate = (devanagariChars + latinChars) / totalLetters;
    }
  }

  const hasCorruptedUnicode = replacementChars > 0 || suspiciousMarks > 0;

  return {
    devanagariChars,
    latinChars,
    persoArabicChars,
    otherChars,
    totalLetters,
    replacementChars,
    suspiciousMarks,
    dominantScript,
    expectedScriptMatchRate,
    hasCorruptedUnicode,
  };
}

/**
 * Universal pre-processing for all scoring profiles:
 * - NFC normalization
 * - Smart quote normalization
 * - Removing bracketed sound cues like [COIN SPINNING] and (music)
 * - Removing speaker labels like ANNOUNCER: or KEITH ROMER:
 * - Normalizing em/en/hyphen dashes to spaces
 * - Rejoining split English contractions (e.g. I 'm -> I'm)
 */
function applyUniversalPreProcessing(text: string): string {
  let s = text.normalize("NFC");

  // Normalize curly single and double quotes
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Remove bracketed cues: […] and (…)
  s = s.replace(/\[[^\]]*\]/g, "");
  s = s.replace(/\([^)]*\)/g, "");

  // Remove speaker labels: an all-caps name of 1–4 words followed by :.
  const speakerRegex = /(?:^|[\r\n]+|(?<=[\.!\?\]"”’'—–-]))\s*((?:[A-Z]+(?:['\-][A-Z]+)*|[A-Z]\.)(?:\s+(?:[A-Z]+(?:['\-][A-Z]+)*|[A-Z]\.)){0,3}):\s*/g;
  let prev: string;
  do {
    prev = s;
    s = s.replace(speakerRegex, " ");
  } while (s !== prev);

  // Turn --, —, –, and - into spaces
  s = s.replace(/--|—|–|-/g, " ");

  // Re-join split English contractions: I 'm → I'm, you 're → you're, don 't → don't
  s = s.replace(/\b([A-Za-z]+)\s+(['’])\s*([A-Za-z]+)\b/g, "$1'$3");

  return s;
}

const DEVA_VOWELS: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};
const DEVA_MATRAS: Record<string, string> = {
  "\u093E": "a", "\u093F": "i", "\u0940": "i", "\u0941": "u", "\u0942": "u",
  "\u0943": "ri", "\u0947": "e", "\u0948": "ai", "\u094B": "o", "\u094C": "au",
};
const DEVA_CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "f", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f",
};

export function devanagariWordToPhoneticRoman(word: string): string {
  if (!/[\u0900-\u097F]/.test(word)) return word.toLowerCase();
  let out = "";
  const chars = Array.from(word.normalize("NFC"));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (DEVA_VOWELS[c]) {
      out += DEVA_VOWELS[c];
    } else if (DEVA_CONSONANTS[c]) {
      const base = DEVA_CONSONANTS[c];
      const next = chars[i + 1];
      if (next === "\u094D") {
        out += base;
        i++; // skip virama
      } else if (next && DEVA_MATRAS[next]) {
        out += base + DEVA_MATRAS[next];
        i++; // skip matra
      } else {
        out += base + "a";
      }
    } else if (c === "\u0902" || c === "\u0901") {
      out += "n";
    } else if (DEVA_MATRAS[c]) {
      out += DEVA_MATRAS[c];
    }
  }
  // Word-final schwa deletion
  if (out.endsWith("a") && out.length > 2) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Language-aware text normalization for ASR evaluation.
 * Deterministic and reproducible. Does NOT perform circular cross-script transliteration.
 */
export function normalizeForScoring(text: string, profile: OutputProfile = "english_latin"): string {
  if (profile === "raw_diagnostic") {
    return text.normalize("NFC").replace(/\s+/g, " ").trim();
  }

  let s = applyUniversalPreProcessing(text);

  // Lowercase Latin characters
  s = s.toLowerCase();

  // Strip Devanagari punctuation (Purna Viram U+0964, Deergh Viram U+0965)
  s = s.replace(/[।॥]/g, " ");

  if (profile === "hindi_devanagari") {
    // Strip zero-width non-joiner (ZWNJ U+200C) and zero-width joiner (ZWJ U+200D)
    s = s.replace(/[\u200C\u200D]/g, "");
  }

  // Delete all other punctuation, keeping letters (\p{L}), combining marks (\p{M}),
  // numbers (\p{N}), whitespace (\s), %, and intra-word apostrophes (')
  s = s.replace(/[^\p{L}\p{M}\p{N}\s%']/gu, " ");
  s = s.replace(/(?<![\p{L}\p{M}\p{N}])'|'(?![\p{L}\p{M}\p{N}])/gu, " ");

  if (profile === "hinglish_script_normalized") {
    // Evaluation-only: phonetic mapping of Devanagari tokens to Roman lexical representation
    const tokens = s.split(/\s+/).map((tok) => devanagariWordToPhoneticRoman(tok));
    s = tokens.join(" ");
  }

  return s.replace(/\s+/g, " ").trim();
}

function alignTokensDP(r: readonly string[], h: readonly string[]): AlignmentCounts {
  const n = r.length;
  const m = h.length;
  const dp = new Int32Array((n + 1) * (m + 1));

  for (let i = 0; i <= n; i++) dp[i * (m + 1)] = i;
  for (let j = 0; j <= m; j++) dp[j] = j;

  for (let i = 1; i <= n; i++) {
    const ri = r[i - 1];
    const row = i * (m + 1);
    const prevRow = (i - 1) * (m + 1);
    for (let j = 1; j <= m; j++) {
      const cost = ri === h[j - 1] ? 0 : 1;
      const sub = dp[prevRow + (j - 1)] + cost;
      const del = dp[prevRow + j] + 1;
      const ins = dp[row + (j - 1)] + 1;
      dp[row + j] = Math.min(sub, del, ins);
    }
  }

  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;

  while (i > 0 || j > 0) {
    const row = i * (m + 1);
    const prevRow = (i - 1) * (m + 1);
    if (i > 0 && j > 0) {
      const match = r[i - 1] === h[j - 1];
      const cost = match ? 0 : 1;
      if (dp[row + j] === dp[prevRow + (j - 1)] + cost) {
        if (!match) substitutions++;
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[row + j] === dp[prevRow + j] + 1) {
      deletions++;
      i--;
      continue;
    }
    if (j > 0 && dp[row + j] === dp[row + (j - 1)] + 1) {
      insertions++;
      j--;
      continue;
    }
  }

  return { substitutions, deletions, insertions };
}

function scoreHirschberg(r: readonly string[], h: readonly string[]): Int32Array {
  let prev = new Int32Array(h.length + 1);
  for (let j = 0; j <= h.length; j++) prev[j] = j;
  for (let i = 1; i <= r.length; i++) {
    const curr = new Int32Array(h.length + 1);
    curr[0] = i;
    const ri = r[i - 1];
    for (let j = 1; j <= h.length; j++) {
      const cost = ri === h[j - 1] ? 0 : 1;
      const sub = prev[j - 1] + cost;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      curr[j] = Math.min(sub, del, ins);
    }
    prev = curr;
  }
  return prev;
}

function alignTokensHirschberg(r: readonly string[], h: readonly string[]): AlignmentCounts {
  if (r.length === 0) {
    return { substitutions: 0, deletions: 0, insertions: h.length };
  }
  if (h.length === 0) {
    return { substitutions: 0, deletions: r.length, insertions: 0 };
  }
  if (r.length === 1) {
    const idx = h.indexOf(r[0]);
    if (idx !== -1) {
      return { substitutions: 0, deletions: 0, insertions: h.length - 1 };
    }
    return { substitutions: 1, deletions: 0, insertions: h.length - 1 };
  }

  const mid = Math.floor(r.length / 2);
  const rLeft = r.slice(0, mid);
  const rRight = r.slice(mid);

  const scoreLeft = scoreHirschberg(rLeft, h);
  const rRightRev = rRight.slice().reverse();
  const hRev = h.slice().reverse();
  const scoreRight = scoreHirschberg(rRightRev, hRev);

  let minCost = Infinity;
  let splitH = 0;
  const hLen = h.length;
  for (let j = 0; j <= hLen; j++) {
    const cost = scoreLeft[j] + scoreRight[hLen - j];
    if (cost < minCost) {
      minCost = cost;
      splitH = j;
    }
  }

  const leftRes = alignTokensHirschberg(rLeft, h.slice(0, splitH));
  const rightRes = alignTokensHirschberg(rRight, h.slice(splitH));
  return {
    substitutions: leftRes.substitutions + rightRes.substitutions,
    deletions: leftRes.deletions + rightRes.deletions,
    insertions: leftRes.insertions + rightRes.insertions,
  };
}

export function alignTokens(r: readonly string[], h: readonly string[]): AlignmentCounts {
  const elements = (r.length + 1) * (h.length + 1);
  if (elements <= SCORING_CONSTANTS.maxFullMatrixElements) {
    return alignTokensDP(r, h);
  }
  return alignTokensHirschberg(r, h);
}

/**
 * Standard Word Error Rate calculation (preserving exact backwards compatibility).
 */
export function wordErrors(
  reference: string,
  hypothesis: string,
  profile: OutputProfile = "english_latin",
): WordErrors {
  const normRef = normalizeForScoring(reference, profile);
  const normHyp = normalizeForScoring(hypothesis, profile);
  const r = normRef.length === 0 ? [] : normRef.split(" ");
  const h = normHyp.length === 0 ? [] : normHyp.split(" ");
  const { substitutions, deletions, insertions } = alignTokens(r, h);
  const referenceWords = r.length;
  const wer = referenceWords === 0
    ? (insertions === 0 ? 0 : 1.0)
    : (substitutions + deletions + insertions) / referenceWords;

  return { substitutions, deletions, insertions, referenceWords, wer };
}

/**
 * Detailed Word Error calculation including rates and accuracy.
 */
export function detailedWordErrors(
  reference: string,
  hypothesis: string,
  profile: OutputProfile = "english_latin",
): DetailedWordErrors {
  const base = wordErrors(reference, hypothesis, profile);
  const deletionRate = base.referenceWords > 0 ? base.deletions / base.referenceWords : 0;
  const insertionRate = base.referenceWords > 0 ? base.insertions / base.referenceWords : 0;
  const substitutionRate = base.referenceWords > 0 ? base.substitutions / base.referenceWords : 0;
  const accuracy = Math.max(0, 1 - base.wer);

  return {
    ...base,
    deletionRate,
    insertionRate,
    substitutionRate,
    accuracy,
  };
}

/**
 * Character error rate calculation (preserving exact backwards compatibility).
 */
export function charErrors(
  reference: string,
  hypothesis: string,
  profile: OutputProfile = "english_latin",
): CharErrors {
  const normRef = normalizeForScoring(reference, profile);
  const normHyp = normalizeForScoring(hypothesis, profile);
  const r = Array.from(normRef.replace(/\s+/g, ""));
  const h = Array.from(normHyp.replace(/\s+/g, ""));
  const { substitutions, deletions, insertions } = alignTokens(r, h);
  const referenceChars = r.length;
  const cer = referenceChars === 0
    ? (insertions === 0 ? 0 : 1.0)
    : (substitutions + deletions + insertions) / referenceChars;

  return { substitutions, deletions, insertions, referenceChars, cer };
}

/**
 * Detailed Character Error calculation with optional grapheme cluster analysis.
 */
export function detailedCharErrors(
  reference: string,
  hypothesis: string,
  profile: OutputProfile = "english_latin",
): DetailedCharErrors {
  const base = charErrors(reference, hypothesis, profile);
  let graphemeErrors: CharErrors | undefined = undefined;

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new (Intl as unknown as { Segmenter: new (loc: string, opt: { granularity: string }) => { segment: (text: string) => Iterable<{ segment: string }> } }).Segmenter("und", { granularity: "grapheme" });
      const normRef = normalizeForScoring(reference, profile).replace(/\s+/g, "");
      const normHyp = normalizeForScoring(hypothesis, profile).replace(/\s+/g, "");
      const rGraphemes = Array.from(segmenter.segment(normRef)).map((s) => s.segment);
      const hGraphemes = Array.from(segmenter.segment(normHyp)).map((s) => s.segment);
      const gCounts = alignTokens(rGraphemes, hGraphemes);
      const gRef = rGraphemes.length;
      const gCer = gRef === 0
        ? (gCounts.insertions === 0 ? 0 : 1.0)
        : (gCounts.substitutions + gCounts.deletions + gCounts.insertions) / gRef;
      graphemeErrors = {
        substitutions: gCounts.substitutions,
        deletions: gCounts.deletions,
        insertions: gCounts.insertions,
        referenceChars: gRef,
        cer: gCer,
      };
    } catch {
      // Graceful fallback
    }
  }

  return {
    ...base,
    graphemeErrors,
  };
}

/**
 * Complete evaluation of an ASR hypothesis against a reference under an explicit profile.
 */
export function evaluateSample(
  reference: string,
  hypothesis: string,
  profile: OutputProfile,
): SampleEvaluation {
  return {
    wordErrors: detailedWordErrors(reference, hypothesis, profile),
    charErrors: detailedCharErrors(reference, hypothesis, profile),
    scriptDiagnostics: analyzeScript(hypothesis, profile),
    normalizedReference: normalizeForScoring(reference, profile),
    normalizedHypothesis: normalizeForScoring(hypothesis, profile),
    profile,
  };
}
