import { createTranscriber } from "../src/index";
import { resampleMono } from "../src/audio/resample";
import {
  BENCHMARK_SCHEMA_VERSION,
  SCORING_METHODOLOGY_VERSION,
  analyzeScript,
  charErrors,
  detailedCharErrors,
  detailedWordErrors,
  normalizeForScoring,
  wordErrors,
  type CharErrors,
  type DetailedCharErrors,
  type DetailedWordErrors,
  type OutputProfile,
  type ScriptBreakdown,
  type WordErrors,
} from "./wer";
import type {
  CaptionLanguage,
  ConditioningMode,
  DecodingProfile,
  Progress,
  RecoveryStrategy,
  TranscribeOptions,
  Transcript,
  TranscriptionDiagnostics,
  WindowSplitStrategy,
} from "../src/types";

export interface ManifestSample {
  sample_id: string;
  category: string;
  language: string;
  source_name?: string;
  dataset_name?: string;
  source_sample_id?: string;
  source_split?: string;
  audio_standardized_path: string;
  audio_original_path?: string;
  transcript_reference_path: string;
  transcript_source_type?: string;
  transcript_script?: string;
  transcript_verification_status?: string;
  duration_seconds: number;
  sample_rate?: number;
  channels?: number;
  checksum_sha256?: string;
  license?: string;
  references?: Record<string, {
    path: string;
    script: string;
    output_profile: OutputProfile;
    verified: boolean;
    verification_notes?: string;
  }>;
  notes?: string;
}

export interface EvalItem {
  id: string;
  category: string;
  sourceDataset?: string;
  language: CaptionLanguage;
  audioUrl: string;
  referenceText: string;
  durationSeconds: number;
  profile: OutputProfile;
  referenceVerified: boolean;
  referenceId: string;
  isStitchedSilence?: boolean;
  silenceSpeechDuration?: number;
  customBlob?: Blob;
}

export interface SampleBenchResult {
  runIndex: number;
  id: string;
  category: string;
  sourceDataset?: string;
  language: string;
  scoringProfile: OutputProfile;
  duration: number;
  detectedLanguage: string;
  referenceVerified: boolean;
  referenceId: string;
  wordErrors: WordErrors;
  detailedWordErrors: DetailedWordErrors;
  charErrors: CharErrors;
  detailedCharErrors: DetailedCharErrors;
  scriptDiagnostics: ScriptBreakdown;
  deletionRate: number;
  maxGapSeconds: number;
  wordsInSilence: number;
  wallTimeMs: number;
  rtf: number;
  stats: Transcript["stats"];
  hypothesisText: string;
  normalizedReference: string;
  normalizedHypothesis: string;
  diagnostics?: TranscriptionDiagnostics;
}

export interface CategorySummary {
  groupKey: string;
  category: string;
  sourceDataset?: string;
  language: string;
  profile: OutputProfile;
  samples: number;
  microWer: number;
  macroWer: number;
  microDelRate: number;
  macroDelRate: number;
  meanCer: number;
  dominantScript: string;
  expectedScriptMatchRate: number;
  meanRtf: number;
  totalWallSeconds: number;
  verified: boolean;
}

export interface BenchResultsPayload {
  benchmarkSchemaVersion: string;
  scoringMethodologyVersion: string;
  label: string;
  model: "tiny" | "base";
  device: "webgpu" | "wasm";
  vad: boolean;
  retry?: boolean;
  conditioning?: string;
  diagnosticsEnabled?: boolean;
  windowPolicy?: WindowSplitStrategy;
  maxWindowSeconds?: number;
  windowOverlapSeconds?: number;
  minSplitPauseSeconds?: number;
  decodingProfile?: DecodingProfile;
  repetitionPenalty?: number;
  noRepeatNgramSize?: number;
  temperature?: number;
  doSample?: boolean;
  recoveryStrategy?: RecoveryStrategy;
  initialPrompt?: string;
  set: "short" | "long" | "all";
  runs: number;
  manifestPath?: string;
  modelLoadTimeMs?: number;
  timestamp: string;
  configurationFingerprint?: {
    gitCommit: string;
    modelId: string;
    backend: string;
    repetitionPenalty?: number;
    noRepeatNgramSize?: number;
    windowPolicy?: string;
    recoveryStrategy?: string;
    maxWindowSecondsHindiHinglish: number;
    maxWindowSecondsEnglish: number;
    scoringProfiles: string[];
  };
  summaryTableMd: string;
  results: SampleBenchResult[];
  categorySummaries: CategorySummary[];
  sourceSummaries?: CategorySummary[];
}

function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeBlobTo16kMono(blob: Blob): Promise<Float32Array> {
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
    sampleRate: 16000,
  });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channel0 = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate === 16000) {
      return new Float32Array(channel0);
    }
    return resampleMono(channel0, audioBuffer.sampleRate, 16000);
  } finally {
    await audioCtx.close();
  }
}

function calculateMaxGap(
  words: readonly { start: number; end: number }[],
  speechSegments?: readonly { start: number; end: number }[],
): number {
  if (words.length < 2) return 0;
  let maxGap = 0;
  for (let i = 1; i < words.length; i++) {
    const gapStart = words[i - 1].end;
    const gapEnd = words[i].start;
    if (gapEnd <= gapStart) continue;

    if (speechSegments && speechSegments.length > 0) {
      let speechGap = 0;
      for (const seg of speechSegments) {
        const overlapStart = Math.max(gapStart, seg.start);
        const overlapEnd = Math.min(gapEnd, seg.end);
        if (overlapEnd > overlapStart) {
          speechGap += overlapEnd - overlapStart;
        }
      }
      if (speechGap > maxGap) {
        maxGap = speechGap;
      }
    } else {
      const gap = gapEnd - gapStart;
      if (gap > maxGap) {
        maxGap = gap;
      }
    }
  }
  return maxGap;
}

function countWordsInSilence(words: readonly { start: number; end: number }[], speechDuration: number): number {
  let count = 0;
  const speechStart = 10.0;
  const speechEnd = 10.0 + speechDuration;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid < speechStart || mid > speechEnd) {
      count++;
    }
  }
  return count;
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(2) + "%";
}

export function selectReferenceForSample(
  sample: ManifestSample,
  mode: CaptionLanguage,
  refMap: Map<string, string>,
): { text: string; profile: OutputProfile; verified: boolean; refId: string } {
  if (mode === "hinglish") {
    // 1. Check explicit structured reference
    const romanMeta = sample.references?.hinglish_roman;
    if (romanMeta && refMap.has(romanMeta.path)) {
      return {
        text: refMap.get(romanMeta.path)!,
        profile: "hinglish_roman",
        verified: romanMeta.verified,
        refId: "hinglish_roman",
      };
    }
    // 2. Check derived roman reference file path
    const directRomanPath = sample.transcript_reference_path.replace("_reference.txt", "_roman_reference.txt");
    if (refMap.has(directRomanPath)) {
      return {
        text: refMap.get(directRomanPath)!,
        profile: "hinglish_roman",
        verified: sample.references?.hinglish_roman ? sample.references.hinglish_roman.verified : true,
        refId: "hinglish_roman",
      };
    }
    const dotRomanPath = sample.transcript_reference_path.replace(/\.txt$/, "_roman.txt");
    if (refMap.has(dotRomanPath)) {
      return {
        text: refMap.get(dotRomanPath)!,
        profile: "hinglish_roman",
        verified: sample.references?.hinglish_roman ? sample.references.hinglish_roman.verified : false,
        refId: "hinglish_roman",
      };
    }
    // 3. Fallback to unverified diagnostic if missing
    return {
      text: refMap.get(sample.transcript_reference_path) ?? "",
      profile: "hinglish_roman",
      verified: false,
      refId: "unverified_fallback",
    };
  }

  if (mode === "hi") {
    const hindiMeta = sample.references?.hindi_devanagari;
    const path = hindiMeta?.path ?? sample.transcript_reference_path;
    return {
      text: refMap.get(path) ?? "",
      profile: "hindi_devanagari",
      verified: hindiMeta ? hindiMeta.verified : true,
      refId: "hindi_devanagari",
    };
  }

  if (mode === "en") {
    const engMeta = sample.references?.english_latin;
    const path = engMeta?.path ?? sample.transcript_reference_path;
    return {
      text: refMap.get(path) ?? "",
      profile: "english_latin",
      verified: engMeta ? engMeta.verified : true,
      refId: "english_latin",
    };
  }

  // mode === "auto"
  if (sample.category === "02_hindi") {
    return {
      text: refMap.get(sample.transcript_reference_path) ?? "",
      profile: "hindi_devanagari",
      verified: true,
      refId: "auto_hindi_devanagari",
    };
  }
  if (sample.category === "03_hinglish") {
    return {
      text: refMap.get(sample.transcript_reference_path) ?? "",
      profile: "mixed_diagnostic",
      verified: true,
      refId: "auto_hinglish_mixed",
    };
  }

  return {
    text: refMap.get(sample.transcript_reference_path) ?? "",
    profile: "english_latin",
    verified: true,
    refId: "auto_english_latin",
  };
}

export function getSourceDataset(sampleId: string, manifestSource?: string): string {
  if (manifestSource) return manifestSource;
  if (sampleId.startsWith("HI_CV_")) return "common_voice_hindi";
  if (sampleId.startsWith("HI_KB_")) return "kathbath_hindi";
  if (sampleId.startsWith("HINGLISH_MUCS_")) return "mucs_2021_hindi_english";
  if (sampleId.startsWith("EN_PODCAST_")) return "npr_podcast";
  return "other";
}

export function buildSampleBenchResult(
  runIdx: number,
  item: EvalItem,
  profile: OutputProfile,
  refText: string,
  hypText: string,
  transcript: Transcript,
  wallTimeMs: number,
  sourceDataset?: string,
): SampleBenchResult {
  const wErr = wordErrors(refText, hypText, profile);
  const detailedW = detailedWordErrors(refText, hypText, profile);
  const cErr = charErrors(refText, hypText, profile);
  const detailedC = detailedCharErrors(refText, hypText, profile);
  const scriptDiag = analyzeScript(hypText, profile);

  const deletionRate = detailedW.deletionRate;
  const maxGapSeconds = calculateMaxGap(transcript.words, transcript.stats.speechSegments);
  const wordsInSilence = item.isStitchedSilence
    ? countWordsInSilence(transcript.words, item.silenceSpeechDuration ?? 3.34)
    : 0;
  const rtf = item.durationSeconds > 0 ? (wallTimeMs / 1000) / item.durationSeconds : 0;

  return {
    runIndex: runIdx,
    id: item.id,
    category: item.category,
    sourceDataset: sourceDataset ?? item.sourceDataset ?? getSourceDataset(item.id),
    language: item.language,
    scoringProfile: profile,
    duration: item.durationSeconds,
    detectedLanguage: transcript.language,
    referenceVerified: item.referenceVerified && profile === item.profile,
    referenceId: profile,
    wordErrors: wErr,
    detailedWordErrors: detailedW,
    charErrors: cErr,
    detailedCharErrors: detailedC,
    scriptDiagnostics: scriptDiag,
    deletionRate,
    maxGapSeconds,
    wordsInSilence,
    wallTimeMs,
    rtf,
    stats: transcript.stats,
    hypothesisText: hypText,
    normalizedReference: normalizeForScoring(refText, profile),
    normalizedHypothesis: normalizeForScoring(hypText, profile),
    diagnostics: transcript.diagnostics,
  };
}

export function computeCategorySummaries(results: SampleBenchResult[]): CategorySummary[] {
  const groups = new Map<string, SampleBenchResult[]>();
  for (const r of results) {
    const hasSpecialProfile =
      r.scoringProfile === "hinglish_mixed_verbatim" ||
      r.scoringProfile === "hinglish_script_normalized";
    const key = hasSpecialProfile
      ? `${r.category} [${r.language}] [${r.scoringProfile}]`
      : `${r.category} [${r.language}]`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(r);
  }

  const summaries: CategorySummary[] = [];

  for (const [groupKey, items] of groups.entries()) {
    const first = items[0];
    const totalRefWords = items.reduce((acc, r) => acc + r.wordErrors.referenceWords, 0);
    const totalErrors = items.reduce(
      (acc, r) => acc + (r.wordErrors.substitutions + r.wordErrors.deletions + r.wordErrors.insertions),
      0,
    );
    const totalDeletions = items.reduce((acc, r) => acc + r.wordErrors.deletions, 0);

    const microWer = totalRefWords > 0 ? totalErrors / totalRefWords : 0;
    const macroWer = items.reduce((acc, r) => acc + r.wordErrors.wer, 0) / items.length;
    const microDelRate = totalRefWords > 0 ? totalDeletions / totalRefWords : 0;
    const macroDelRate = items.reduce((acc, r) => acc + r.deletionRate, 0) / items.length;
    const meanCer = items.reduce((acc, r) => acc + r.charErrors.cer, 0) / items.length;
    const meanRtf = items.reduce((acc, r) => acc + r.rtf, 0) / items.length;
    const totalWallSeconds = items.reduce((acc, r) => acc + r.wallTimeMs, 0) / 1000;
    const expectedScriptMatchRate =
      items.reduce((acc, r) => acc + r.scriptDiagnostics.expectedScriptMatchRate, 0) / items.length;

    // Dominant script across samples
    const scriptCounts = new Map<string, number>();
    for (const r of items) {
      const s = r.scriptDiagnostics.dominantScript;
      scriptCounts.set(s, (scriptCounts.get(s) ?? 0) + 1);
    }
    let dominantScript = "none";
    let maxCount = 0;
    for (const [script, count] of scriptCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantScript = script;
      }
    }

    const verified = items.every((r) => r.referenceVerified);

    summaries.push({
      groupKey,
      category: first.category,
      sourceDataset: first.sourceDataset,
      language: first.language,
      profile: first.scoringProfile,
      samples: items.length,
      microWer,
      macroWer,
      microDelRate,
      macroDelRate,
      meanCer,
      dominantScript,
      expectedScriptMatchRate,
      meanRtf,
      totalWallSeconds,
      verified,
    });
  }

  return summaries;
}

export function computeSourceSummaries(results: SampleBenchResult[]): CategorySummary[] {
  const groups = new Map<string, SampleBenchResult[]>();
  for (const r of results) {
    const src = r.sourceDataset ?? getSourceDataset(r.id);
    const hasSpecialProfile =
      r.scoringProfile === "hinglish_mixed_verbatim" ||
      r.scoringProfile === "hinglish_script_normalized";
    const key = hasSpecialProfile
      ? `${src} [${r.language}] [${r.scoringProfile}]`
      : `${src} [${r.language}]`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(r);
  }

  const summaries: CategorySummary[] = [];

  for (const [groupKey, items] of groups.entries()) {
    const first = items[0];
    const totalRefWords = items.reduce((acc, r) => acc + r.wordErrors.referenceWords, 0);
    const totalErrors = items.reduce(
      (acc, r) => acc + (r.wordErrors.substitutions + r.wordErrors.deletions + r.wordErrors.insertions),
      0,
    );
    const totalDeletions = items.reduce((acc, r) => acc + r.wordErrors.deletions, 0);

    const microWer = totalRefWords > 0 ? totalErrors / totalRefWords : 0;
    const macroWer = items.reduce((acc, r) => acc + r.wordErrors.wer, 0) / items.length;
    const microDelRate = totalRefWords > 0 ? totalDeletions / totalRefWords : 0;
    const macroDelRate = items.reduce((acc, r) => acc + r.deletionRate, 0) / items.length;
    const meanCer = items.reduce((acc, r) => acc + r.charErrors.cer, 0) / items.length;
    const meanRtf = items.reduce((acc, r) => acc + r.rtf, 0) / items.length;
    const totalWallSeconds = items.reduce((acc, r) => acc + r.wallTimeMs, 0) / 1000;
    const expectedScriptMatchRate =
      items.reduce((acc, r) => acc + r.scriptDiagnostics.expectedScriptMatchRate, 0) / items.length;

    const scriptCounts = new Map<string, number>();
    for (const r of items) {
      const s = r.scriptDiagnostics.dominantScript;
      scriptCounts.set(s, (scriptCounts.get(s) ?? 0) + 1);
    }
    let dominantScript = "none";
    let maxCount = 0;
    for (const [script, count] of scriptCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantScript = script;
      }
    }

    const verified = items.every((r) => r.referenceVerified);

    summaries.push({
      groupKey,
      category: first.category,
      sourceDataset: first.sourceDataset ?? getSourceDataset(first.id),
      language: first.language,
      profile: first.scoringProfile,
      samples: items.length,
      microWer,
      macroWer,
      microDelRate,
      macroDelRate,
      meanCer,
      dominantScript,
      expectedScriptMatchRate,
      meanRtf,
      totalWallSeconds,
      verified,
    });
  }

  return summaries;
}

function generateSummaryMarkdown(payload: Omit<BenchResultsPayload, "summaryTableMd">): string {
  const lines: string[] = [];
  const retryStr = payload.retry !== undefined ? ` | Retry: ${payload.retry ? "on" : "off"}` : "";
  const condStr = payload.conditioning ? ` | Cond: ${payload.conditioning}` : "";
  lines.push(
    `| Config | Model: ${payload.model} | Device: ${payload.device} | VAD: ${payload.vad ? "on" : "off"}${retryStr}${condStr} | Set: ${payload.set} | Runs: ${payload.runs} | Schema: ${payload.benchmarkSchemaVersion} | Methodology: ${payload.scoringMethodologyVersion} |`,
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  lines.push("");
  lines.push(
    "| Sample ID | Lang | Profile | Dur (s) | Ref Words | Hyp Words | WER | S | D | I | Del Rate | CER | Script (D/L/A/O) | Match % | Max Gap (s) | Sil Words | Wall (s) | RTF | VAD | Win | Retry | Ver |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );

  for (const r of payload.results) {
    const dur = r.duration.toFixed(1);
    const wer = formatPercent(r.wordErrors.wer);
    const del = formatPercent(r.deletionRate);
    const cer = formatPercent(r.charErrors.cer);
    const gap = r.maxGapSeconds.toFixed(2);
    const wall = (r.wallTimeMs / 1000).toFixed(1);
    const rtf = r.rtf.toFixed(3);
    const statsAny = r.stats as unknown as { vad?: string; windows?: number; retriedWindows?: number };
    const vadType = statsAny?.vad ?? (payload.vad ? "silero" : "off");
    const win = statsAny?.windows ?? 1;
    const retry = statsAny?.retriedWindows ?? 0;
    const sd = r.scriptDiagnostics;
    const scriptSummary = `${sd.devanagariChars}/${sd.latinChars}/${sd.persoArabicChars}/${sd.otherChars}`;
    const matchPct = formatPercent(sd.expectedScriptMatchRate);
    const ver = r.referenceVerified ? "Yes" : "No";

    lines.push(
      `| ${r.id} | ${r.language} | ${r.scoringProfile} | ${dur} | ${r.wordErrors.referenceWords} | ${r.wordErrors.referenceWords - r.wordErrors.deletions + r.wordErrors.insertions} | ${wer} | ${r.wordErrors.substitutions} | ${r.wordErrors.deletions} | ${r.wordErrors.insertions} | ${del} | ${cer} | ${scriptSummary} | ${matchPct} | ${gap} | ${r.wordsInSilence} | ${wall} | ${rtf} | ${vadType} | ${win} | ${retry} | ${ver} |`,
    );
  }

  // Summary by category and mode
  lines.push("");
  lines.push("### Mode-Specific Category Summaries");
  lines.push(
    "| Category & Mode | Profile | Samples | Micro WER | Macro WER | Micro Del Rate | Mean CER | Script Match % | Mean RTF | Total Wall (s) | Verified |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");

  for (const sum of payload.categorySummaries) {
    const microW = formatPercent(sum.microWer);
    const macroW = formatPercent(sum.macroWer);
    const microD = formatPercent(sum.microDelRate);
    const cer = formatPercent(sum.meanCer);
    const scriptPct = formatPercent(sum.expectedScriptMatchRate);
    const rtf = sum.meanRtf.toFixed(3);
    const wall = sum.totalWallSeconds.toFixed(1);
    const ver = sum.verified ? "Yes" : "No";

    lines.push(
      `| ${sum.groupKey} | ${sum.profile} | ${sum.samples} | ${microW} | ${macroW} | ${microD} | ${cer} | ${scriptPct} | ${rtf} | ${wall} | ${ver} |`,
    );
  }

  if (payload.sourceSummaries && payload.sourceSummaries.length > 0) {
    lines.push("");
    lines.push("### Source Dataset Summaries");
    lines.push(
      "| Source Dataset & Mode | Profile | Samples | Micro WER | Macro WER | Micro Del Rate | Mean CER | Script Match % | Mean RTF | Total Wall (s) | Verified |",
    );
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");

    for (const sum of payload.sourceSummaries) {
      const microW = formatPercent(sum.microWer);
      const macroW = formatPercent(sum.macroWer);
      const microD = formatPercent(sum.microDelRate);
      const cer = formatPercent(sum.meanCer);
      const scriptPct = formatPercent(sum.expectedScriptMatchRate);
      const rtf = sum.meanRtf.toFixed(3);
      const wall = sum.totalWallSeconds.toFixed(1);
      const ver = sum.verified ? "Yes" : "No";

      lines.push(
        `| ${sum.groupKey} | ${sum.profile} | ${sum.samples} | ${microW} | ${macroW} | ${microD} | ${cer} | ${scriptPct} | ${rtf} | ${wall} | ${ver} |`,
      );
    }
  }

  return lines.join("\n");
}

function appendResultRow(tbody: HTMLElement | null, r: SampleBenchResult) {
  if (!tbody) return;
  const tr = document.createElement("tr");
  const werPct = formatPercent(r.wordErrors.wer);
  const delPct = formatPercent(r.deletionRate);
  const cerPct = formatPercent(r.charErrors.cer);
  const werClass = r.wordErrors.wer < 0.15 ? "badge-pass" : r.wordErrors.wer < 0.4 ? "badge-warn" : "badge-fail";
  const sd = r.scriptDiagnostics;
  const scriptStr = `${sd.devanagariChars}/${sd.latinChars}/${sd.persoArabicChars}/${sd.otherChars}`;
  const verBadge = r.referenceVerified ? `<span class="badge badge-pass">Yes</span>` : `<span class="badge badge-warn">No</span>`;
  const statsAny = r.stats as unknown as { vad?: string };
  const vadType = statsAny?.vad ?? "off";

  tr.innerHTML = `
    <td><strong>${r.id}</strong></td>
    <td>${r.category.replace(/^\d+_/, "")}</td>
    <td>${r.language}</td>
    <td><code>${r.scoringProfile}</code></td>
    <td>${r.duration.toFixed(1)}s</td>
    <td>${r.wordErrors.referenceWords}</td>
    <td>${r.stats.windows ? r.wordErrors.referenceWords - r.wordErrors.deletions + r.wordErrors.insertions : r.hypothesisText.split(/\s+/).filter(Boolean).length}</td>
    <td><span class="badge ${werClass}">${werPct}</span></td>
    <td>${r.wordErrors.substitutions}/${r.wordErrors.deletions}/${r.wordErrors.insertions}</td>
    <td>${delPct}</td>
    <td>${cerPct}</td>
    <td><span class="badge badge-neutral">${scriptStr}</span></td>
    <td>${r.maxGapSeconds.toFixed(2)}s</td>
    <td>${r.wordsInSilence > 0 ? `<span class="badge badge-fail">${r.wordsInSilence}</span>` : "0"}</td>
    <td>${(r.wallTimeMs / 1000).toFixed(1)}s</td>
    <td>${r.rtf.toFixed(3)}</td>
    <td>${vadType}</td>
    <td>${verBadge}</td>
  `;
  tbody.appendChild(tr);
}

async function runBenchmark() {
  const urlParams = new URLSearchParams(window.location.search);
  const model = (urlParams.get("model") ?? "tiny") as "tiny" | "base";
  const device = (urlParams.get("device") ?? (("gpu" in navigator) ? "webgpu" : "wasm")) as "webgpu" | "wasm";
  const label = urlParams.get("label") ?? "baseline";
  const vad = (urlParams.get("vad") ?? "off") === "on";
  const retryParam = urlParams.get("retry");
  const retry = retryParam === null ? (label === "vad" ? false : true) : retryParam === "on";
  const conditioning = (urlParams.get("conditioning") ?? "legacy") as ConditioningMode;
  const diagnostics = (urlParams.get("diagnostics") ?? "on") === "on";
  const sampleFilter = urlParams.get("sample") ?? "all";
  const setChoice = (urlParams.get("set") ?? "short") as "short" | "long" | "all";
  const runs = Math.max(1, parseInt(urlParams.get("runs") ?? "1", 10));
  const windowPolicy = (urlParams.get("windowPolicy") ?? undefined) as WindowSplitStrategy | undefined;
  const maxWindowSeconds = urlParams.has("maxWindow") ? parseFloat(urlParams.get("maxWindow")!) : undefined;
  const windowOverlapSeconds = urlParams.has("overlap") ? parseFloat(urlParams.get("overlap")!) : undefined;
  const minSplitPauseSeconds = urlParams.has("splitPause") ? parseFloat(urlParams.get("splitPause")!) : undefined;
  const decodingProfile = (urlParams.get("decoding") ?? undefined) as DecodingProfile | undefined;
  const repetitionPenalty = urlParams.has("repPenalty") ? parseFloat(urlParams.get("repPenalty")!) : undefined;
  const noRepeatNgramSize = urlParams.has("noRepeatNgram") ? parseInt(urlParams.get("noRepeatNgram")!, 10) : undefined;
  const temperature = urlParams.has("temp") ? parseFloat(urlParams.get("temp")!) : undefined;
  const doSample = urlParams.has("doSample") ? (urlParams.get("doSample") === "true" || urlParams.get("doSample") === "on") : undefined;
  const recoveryStrategy = (urlParams.get("recovery") ?? undefined) as RecoveryStrategy | undefined;
  const initialPrompt = urlParams.get("prompt") ?? undefined;

  const statModel = document.getElementById("stat-model");
  const statVad = document.getElementById("stat-vad");
  const statAudioTime = document.getElementById("stat-audio-time");
  const statRtf = document.getElementById("stat-rtf");
  const statusTitle = document.getElementById("status-title");
  const statusBox = document.getElementById("status-box");
  const progressBar = document.getElementById("progress-bar");
  const tbody = document.getElementById("results-tbody");
  const summaryTables = document.getElementById("summary-tables");

  if (statModel) statModel.textContent = `${model} (${device})`;
  if (statVad) statVad.textContent = vad ? "Silero VAD (on)" : "Fixed Windows (off)";

  function logStatus(title: string, detail: string, pct = 0) {
    if (statusTitle) statusTitle.textContent = title;
    if (statusBox) statusBox.textContent = detail;
    if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  logStatus("Loading manifest...", "Fetching manifest");
  const manifestParam = urlParams.get("manifest") ?? "manifest.json";
  const manifestUrl = manifestParam.startsWith("/") ? manifestParam : `/eval/${manifestParam}`;
  const isCustomManifest = manifestParam !== "manifest.json";

  logStatus("Loading manifest...", `Fetching ${manifestUrl}`);
  const manifestResp = await fetch(manifestUrl);
  if (!manifestResp.ok) throw new Error(`Failed to load ${manifestUrl}`);
  const manifest = (await manifestResp.json()) as ManifestSample[];

  const refMap = new Map<string, string>();
  for (const s of manifest) {
    // Primary reference
    const textResp = await fetch(`/eval/${s.transcript_reference_path}`);
    if (textResp.ok) {
      refMap.set(s.transcript_reference_path, await textResp.text());
    }

    // Companion Roman reference for Hinglish
    if (s.category === "03_hinglish") {
      const romanPath1 = s.transcript_reference_path.replace("_reference.txt", "_roman_reference.txt");
      const romanPath2 = s.transcript_reference_path.replace(/\.txt$/, "_roman.txt");
      for (const rPath of [romanPath1, romanPath2]) {
        if (!refMap.has(rPath)) {
          const romanResp = await fetch(`/eval/${rPath}`);
          if (romanResp.ok) {
            refMap.set(rPath, await romanResp.text());
          }
        }
      }
    }

    // Load any explicitly declared references in manifest
    if (s.references) {
      for (const refMeta of Object.values(s.references)) {
        if (!refMap.has(refMeta.path)) {
          const resp = await fetch(`/eval/${refMeta.path}`);
          if (resp.ok) {
            refMap.set(refMeta.path, await resp.text());
          }
        }
      }
    }
  }

  // Load English regression control sample if running custom manifest
  let englishControlSample: ManifestSample | undefined;
  if (isCustomManifest) {
    try {
      const baseManifestResp = await fetch("/eval/manifest.json");
      if (baseManifestResp.ok) {
        const baseManifest = (await baseManifestResp.json()) as ManifestSample[];
        englishControlSample = baseManifest.find((s) => s.sample_id === "EN_PODCAST_001");
        if (englishControlSample) {
          const engRefResp = await fetch(`/eval/${englishControlSample.transcript_reference_path}`);
          if (engRefResp.ok) {
            refMap.set(englishControlSample.transcript_reference_path, await engRefResp.text());
          }
        }
      }
    } catch (e) {
      console.warn("Could not load base manifest for English control:", e);
    }
  }

  const longRefResp = await fetch("/eval/derived/EN_PODCAST_FULL_reference.txt");
  let longRefText = "";
  if (longRefResp.ok) {
    longRefText = await longRefResp.text();
  }

  // Build evaluation queue
  let items: EvalItem[] = [];

  if (isCustomManifest) {
    // 1. English regression control sample
    if (englishControlSample) {
      const refInfo = selectReferenceForSample(englishControlSample, "en", refMap);
      items.push({
        id: englishControlSample.sample_id,
        category: englishControlSample.category,
        sourceDataset: "npr_podcast",
        language: "en",
        audioUrl: `/eval/${englishControlSample.audio_standardized_path}`,
        referenceText: refInfo.text,
        durationSeconds: englishControlSample.duration_seconds,
        profile: refInfo.profile,
        referenceVerified: refInfo.verified,
        referenceId: refInfo.refId,
      });
    }

    // 2. Hindi & Hinglish samples from custom manifest
    for (const s of manifest) {
      const audioUrl = `/eval/${s.audio_standardized_path}`;
      const srcDataset = s.dataset_name ?? getSourceDataset(s.sample_id);

      if (s.category === "02_hindi") {
        const refInfoHi = selectReferenceForSample(s, "hi", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          sourceDataset: srcDataset,
          language: "hi",
          audioUrl,
          referenceText: refInfoHi.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoHi.profile,
          referenceVerified: refInfoHi.verified,
          referenceId: refInfoHi.refId,
        });
      } else if (s.category === "03_hinglish") {
        const refInfoHinglish = selectReferenceForSample(s, "hinglish", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          sourceDataset: srcDataset,
          language: "hinglish",
          audioUrl,
          referenceText: refInfoHinglish.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoHinglish.profile,
          referenceVerified: refInfoHinglish.verified,
          referenceId: refInfoHinglish.refId,
        });
      } else {
        const lang = (s.language as CaptionLanguage) ?? "en";
        const refInfo = selectReferenceForSample(s, lang, refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          sourceDataset: srcDataset,
          language: lang,
          audioUrl,
          referenceText: refInfo.text,
          durationSeconds: s.duration_seconds,
          profile: refInfo.profile,
          referenceVerified: refInfo.verified,
          referenceId: refInfo.refId,
        });
      }
    }
  } else if (setChoice === "short" || setChoice === "all") {
    for (const s of manifest) {
      const audioUrl = `/eval/${s.audio_standardized_path}`;

      if (s.category === "01_english_podcast") {
        const refInfo = selectReferenceForSample(s, "en", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "en",
          audioUrl,
          referenceText: refInfo.text,
          durationSeconds: s.duration_seconds,
          profile: refInfo.profile,
          referenceVerified: refInfo.verified,
          referenceId: refInfo.refId,
        });
      } else if (s.category === "02_hindi") {
        // 1. Primary forced Hindi evaluation (Devanagari)
        const refInfoHi = selectReferenceForSample(s, "hi", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "hi",
          audioUrl,
          referenceText: refInfoHi.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoHi.profile,
          referenceVerified: refInfoHi.verified,
          referenceId: refInfoHi.refId,
        });

        // 2. Diagnostic auto-detect evaluation
        const refInfoAuto = selectReferenceForSample(s, "auto", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "auto",
          audioUrl,
          referenceText: refInfoAuto.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoAuto.profile,
          referenceVerified: refInfoAuto.verified,
          referenceId: refInfoAuto.refId,
        });
      } else if (s.category === "03_hinglish") {
        // 1. Primary forced Hinglish evaluation (Romanized Hinglish)
        const refInfoHinglish = selectReferenceForSample(s, "hinglish", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "hinglish",
          audioUrl,
          referenceText: refInfoHinglish.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoHinglish.profile,
          referenceVerified: refInfoHinglish.verified,
          referenceId: refInfoHinglish.refId,
        });

        // 2. Diagnostic auto-detect evaluation
        const refInfoAuto = selectReferenceForSample(s, "auto", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "auto",
          audioUrl,
          referenceText: refInfoAuto.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoAuto.profile,
          referenceVerified: refInfoAuto.verified,
          referenceId: refInfoAuto.refId,
        });

        // 3. Diagnostic forced Hindi evaluation
        const refInfoHi = selectReferenceForSample(s, "hi", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "hi",
          audioUrl,
          referenceText: refInfoHi.text,
          durationSeconds: s.duration_seconds,
          profile: refInfoHi.profile,
          referenceVerified: refInfoHi.verified,
          referenceId: refInfoHi.refId,
        });
      } else {
        // 04_noisy_vlog
        const refInfo = selectReferenceForSample(s, "en", refMap);
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "en",
          audioUrl,
          referenceText: refInfo.text,
          durationSeconds: s.duration_seconds,
          profile: refInfo.profile,
          referenceVerified: refInfo.verified,
          referenceId: refInfo.refId,
        });
      }
    }
  }

  if (setChoice === "long" || setChoice === "all") {
    // 1. Full NPR episode
    items.push({
      id: "EN_PODCAST_FULL",
      category: "01_english_podcast",
      language: "en",
      audioUrl: "/eval/01_english_podcast/audio/original/EN_PODCAST_001_full_episode.mp3",
      referenceText: longRefText,
      durationSeconds: 1704.6,
      profile: "english_latin",
      referenceVerified: true,
      referenceId: "english_full_podcast",
    });

    // 2. 10m manual loop
    const sentence = "This is a local off-cut transcription test. The video never leaves this computer. We are checking word time stamps, cancellation, and model caching.";
    const sentencePartial = "This is a local off-cut transcription test.";
    const repeats10m = Array(55).fill(sentence).join(" ") + " " + sentencePartial;
    items.push({
      id: "MANUAL_ENGLISH_10M",
      category: "01_english_podcast",
      language: "en",
      audioUrl: "/manual-english-10m.wav",
      referenceText: repeats10m,
      durationSeconds: 600.0,
      profile: "english_latin",
      referenceVerified: true,
      referenceId: "english_manual_loop",
    });

    // 3. STITCH_HINGLISH (in-memory)
    logStatus("Building STITCH_HINGLISH...", "Fetching and concatenating CoSHE clips in memory");
    const coshe1Blob = await (await fetch("/eval/03_hinglish/audio/standardized/HINGLISH_COSHE_001.wav")).blob();
    const coshe2Blob = await (await fetch("/eval/03_hinglish/audio/standardized/HINGLISH_COSHE_002.wav")).blob();
    const coshe3Blob = await (await fetch("/eval/03_hinglish/audio/standardized/HINGLISH_COSHE_003.wav")).blob();

    const pcm1 = await decodeBlobTo16kMono(coshe1Blob);
    const pcm2 = await decodeBlobTo16kMono(coshe2Blob);
    const pcm3 = await decodeBlobTo16kMono(coshe3Blob);
    const silence15s = new Float32Array(Math.round(1.5 * 16000));

    const totalLen = pcm1.length + silence15s.length + pcm2.length + silence15s.length + pcm3.length;
    const stitchedPcm = new Float32Array(totalLen);
    let offset = 0;
    stitchedPcm.set(pcm1, offset); offset += pcm1.length;
    stitchedPcm.set(silence15s, offset); offset += silence15s.length;
    stitchedPcm.set(pcm2, offset); offset += pcm2.length;
    stitchedPcm.set(silence15s, offset); offset += silence15s.length;
    stitchedPcm.set(pcm3, offset);

    const stitchedHinglishBlob = float32ToWavBlob(stitchedPcm, 16000);
    const stitchedMixedRef = [
      refMap.get("03_hinglish/transcripts/HINGLISH_COSHE_001_reference.txt") ?? "",
      refMap.get("03_hinglish/transcripts/HINGLISH_COSHE_002_reference.txt") ?? "",
      refMap.get("03_hinglish/transcripts/HINGLISH_COSHE_003_reference.txt") ?? "",
    ].join(" ");
    const stitchedRomanRef = [
      refMap.get("03_hinglish/transcripts/HINGLISH_COSHE_001_roman_reference.txt") ?? "",
      refMap.get("03_hinglish/transcripts/HINGLISH_COSHE_002_roman_reference.txt") ?? "",
      refMap.get("03_hinglish/transcripts/HINGLISH_COSHE_003_roman_reference.txt") ?? "",
    ].join(" ");
    const stitchedDuration = totalLen / 16000;

    // Stitched Hinglish (Primary Romanized mode)
    items.push({
      id: "STITCH_HINGLISH",
      category: "03_hinglish",
      language: "hinglish",
      audioUrl: "memory:STITCH_HINGLISH",
      referenceText: stitchedRomanRef,
      durationSeconds: stitchedDuration,
      customBlob: stitchedHinglishBlob,
      profile: "hinglish_roman",
      referenceVerified: true,
      referenceId: "stitched_hinglish_roman",
    });

    // Stitched Hinglish (Diagnostic auto mode)
    items.push({
      id: "STITCH_HINGLISH",
      category: "03_hinglish",
      language: "auto",
      audioUrl: "memory:STITCH_HINGLISH",
      referenceText: stitchedMixedRef,
      durationSeconds: stitchedDuration,
      customBlob: stitchedHinglishBlob,
      profile: "mixed_diagnostic",
      referenceVerified: true,
      referenceId: "stitched_hinglish_mixed",
    });

    // 4. STITCH_SILENCE (in-memory)
    logStatus("Building STITCH_SILENCE...", "Synthesizing 10s silence + VLOG_DRIVE_003 + 10s silence in memory");
    const vlog3Blob = await (await fetch("/eval/04_noisy_vlog/audio/standardized/VLOG_DRIVE_003.wav")).blob();
    const vlog3Pcm = await decodeBlobTo16kMono(vlog3Blob);
    const silence10s = new Float32Array(10 * 16000);

    const stitchSilenceLen = silence10s.length + vlog3Pcm.length + silence10s.length;
    const stitchSilencePcm = new Float32Array(stitchSilenceLen);
    let sOffset = 0;
    stitchSilencePcm.set(silence10s, sOffset); sOffset += silence10s.length;
    stitchSilencePcm.set(vlog3Pcm, sOffset); sOffset += vlog3Pcm.length;
    stitchSilencePcm.set(silence10s, sOffset);

    const stitchSilenceBlob = float32ToWavBlob(stitchSilencePcm, 16000);
    const vlog3Ref = refMap.get("04_noisy_vlog/transcripts/VLOG_DRIVE_003_reference.txt") ?? "";
    const vlog3Dur = vlog3Pcm.length / 16000;

    items.push({
      id: "STITCH_SILENCE",
      category: "04_noisy_vlog",
      language: "en",
      audioUrl: "memory:STITCH_SILENCE",
      referenceText: vlog3Ref,
      durationSeconds: stitchSilenceLen / 16000,
      isStitchedSilence: true,
      silenceSpeechDuration: vlog3Dur,
      customBlob: stitchSilenceBlob,
      profile: "english_latin",
      referenceVerified: true,
      referenceId: "stitched_silence_english",
    });
  }

  if (sampleFilter !== "all") {
    items = items.filter((item) => item.id === sampleFilter);
    if (items.length === 0) {
      throw new Error(`Sample filter "${sampleFilter}" matched no benchmark items.`);
    }
  }

  const effectiveRecovery: RecoveryStrategy =
    recoveryStrategy ?? (urlParams.get("recovery") === "none" ? "none" : (retry ? "ladder" : "none"));

  const transcriber = createTranscriber({ model, device });
  logStatus("Loading model...", `Initializing ${model} on ${device}`);
  const tLoad0 = performance.now();
  await transcriber.load((prog) => {
    if ("loaded" in prog && "total" in prog) {
      const pct = Math.round((prog.loaded / prog.total) * 100);
      logStatus(`Downloading ${prog.file}...`, `${(prog.loaded / 1024 / 1024).toFixed(1)}MB / ${(prog.total / 1024 / 1024).toFixed(1)}MB`, pct);
    } else {
      logStatus("Loading model...", `Stage: ${prog.stage}`);
    }
  });
  const modelLoadTimeMs = performance.now() - tLoad0;

  const results: SampleBenchResult[] = [];
  const totalSteps = runs * items.length;
  let currentStep = 0;
  let totalEvaluatedSeconds = 0;
  let totalWallTimeMs = 0;

  try {
    for (let runIdx = 1; runIdx <= runs; runIdx++) {
      for (const item of items) {
        currentStep++;
        const stepPct = Math.round(((currentStep - 1) / totalSteps) * 100);
        logStatus(
          `Evaluating (${currentStep}/${totalSteps}): ${item.id} [${item.language}]`,
          `Run ${runIdx}/${runs} | Cat: ${item.category} | Profile: ${item.profile} | Dur: ${item.durationSeconds.toFixed(1)}s`,
          stepPct,
        );

        let blob: Blob;
        if (item.customBlob) {
          blob = item.customBlob;
        } else {
          const resp = await fetch(item.audioUrl);
          if (!resp.ok) throw new Error(`Failed to fetch audio from ${item.audioUrl}`);
          blob = await resp.blob();
        }

        const itemMaxWindow = maxWindowSeconds ?? (item.language === "en" ? 30 : 15);
        const transcribeOpts: TranscribeOptions & { retry?: boolean } = {
          language: item.language,
          vad,
          retry: effectiveRecovery !== "none",
          conditioning,
          diagnostics,
          windowPolicy: windowPolicy ?? "adaptive_pause",
          maxWindowSeconds: itemMaxWindow,
          windowOverlapSeconds,
          minSplitPauseSeconds,
          decodingProfile: decodingProfile ?? "combined",
          repetitionPenalty: repetitionPenalty ?? 1.15,
          noRepeatNgramSize: noRepeatNgramSize ?? 3,
          temperature,
          doSample,
          recoveryStrategy: effectiveRecovery,
          initialPrompt,
          onProgress: (prog: Progress) => {
            const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
            const secStr = "seconds" in prog ? `${prog.seconds.toFixed(1)}s / ${item.durationSeconds.toFixed(1)}s` : "";
            logStatus(
              `Evaluating (${currentStep}/${totalSteps}): ${item.id} [${item.language}]`,
              `Stage: ${prog.stage} ${secStr} (${elapsed}s elapsed)`,
              stepPct,
            );
          },
        };

        const t0 = performance.now();
        let transcript: Transcript;
        try {
          transcript = await transcriber.transcribe(blob, transcribeOpts);
        } catch (sampleErr) {
          console.error(`Inference error on sample ${item.id}:`, sampleErr);
          transcript = {
            language: item.language,
            duration: item.durationSeconds,
            granularity: "word",
            segments: [],
            words: [],
            stats: {
              model,
              device,
              dtype: "unknown",
              loadMs: modelLoadTimeMs,
              decodeMs: 0,
              transcribeMs: performance.now() - t0,
              realTimeFactor: 0,
              windows: 0,
              retriedWindows: 0,
            },
          };
        }

        const wallTimeMs = performance.now() - t0;
        totalEvaluatedSeconds += item.durationSeconds;
        totalWallTimeMs += wallTimeMs;

        const hypText = transcript.words.length > 0
          ? transcript.words.map((w) => w.text).join(" ")
          : transcript.segments.map((s) => s.text).join(" ");

        // Primary scored result for this item
        const primaryResult = buildSampleBenchResult(
          runIdx,
          item,
          item.profile,
          item.referenceText,
          hypText,
          transcript,
          wallTimeMs,
          item.sourceDataset,
        );
        results.push(primaryResult);
        appendResultRow(tbody, primaryResult);

        // If Hinglish, also evaluate the other two dimensions from the SAME single inference pass
        if (item.category === "03_hinglish") {
          const verbatimRef = refMap.get(
            item.id.startsWith("HINGLISH_MUCS_")
              ? `processed/hinglish/references/${item.id}.txt`
              : "03_hinglish/transcripts/HINGLISH_COSHE_001_reference.txt",
          ) ?? item.referenceText;

          // Dimension A: hinglish_mixed_verbatim
          const verbatimResult = buildSampleBenchResult(
            runIdx,
            item,
            "hinglish_mixed_verbatim",
            verbatimRef,
            hypText,
            transcript,
            wallTimeMs,
            item.sourceDataset,
          );
          results.push(verbatimResult);
          appendResultRow(tbody, verbatimResult);

          // Dimension B: hinglish_script_normalized
          const normResult = buildSampleBenchResult(
            runIdx,
            item,
            "hinglish_script_normalized",
            verbatimRef,
            hypText,
            transcript,
            wallTimeMs,
            item.sourceDataset,
          );
          results.push(normResult);
          appendResultRow(tbody, normResult);
        }

        if (statAudioTime) statAudioTime.textContent = `${totalEvaluatedSeconds.toFixed(1)}s`;
        if (statRtf) statRtf.textContent = `${((totalWallTimeMs / 1000) / totalEvaluatedSeconds).toFixed(3)}x`;
      }
    }
  } finally {
    transcriber.dispose();
  }

  logStatus("Benchmark complete!", "Generating summaries and saving results...", 100);

  const categorySummaries = computeCategorySummaries(results);
  const sourceSummaries = computeSourceSummaries(results);

  const basePayload = {
    benchmarkSchemaVersion: BENCHMARK_SCHEMA_VERSION,
    scoringMethodologyVersion: SCORING_METHODOLOGY_VERSION,
    label,
    model,
    device,
    vad,
    retry: effectiveRecovery !== "none",
    conditioning,
    diagnosticsEnabled: diagnostics,
    windowPolicy: windowPolicy ?? "adaptive_pause",
    maxWindowSeconds,
    windowOverlapSeconds,
    minSplitPauseSeconds,
    decodingProfile: decodingProfile ?? "combined",
    repetitionPenalty: repetitionPenalty ?? 1.15,
    noRepeatNgramSize: noRepeatNgramSize ?? 3,
    temperature,
    doSample,
    recoveryStrategy: effectiveRecovery,
    initialPrompt,
    set: setChoice,
    runs,
    manifestPath: manifestParam,
    modelLoadTimeMs,
    timestamp: new Date().toISOString(),
    configurationFingerprint: {
      gitCommit: "19253ea",
      modelId: model === "base" ? "onnx-community/whisper-base_timestamped" : "onnx-community/whisper-tiny_timestamped",
      backend: device,
      repetitionPenalty: repetitionPenalty ?? 1.15,
      noRepeatNgramSize: noRepeatNgramSize ?? 3,
      windowPolicy: windowPolicy ?? "adaptive_pause",
      recoveryStrategy: effectiveRecovery,
      maxWindowSecondsHindiHinglish: 15,
      maxWindowSecondsEnglish: 30,
      scoringProfiles: ["hindi_devanagari", "hinglish_roman", "hinglish_mixed_verbatim", "hinglish_script_normalized", "english_latin"],
    },
    results,
    categorySummaries,
    sourceSummaries,
  };

  const summaryTableMd = generateSummaryMarkdown(basePayload);
  const fullPayload: BenchResultsPayload = {
    ...basePayload,
    summaryTableMd,
  };

  if (summaryTables) {
    summaryTables.innerHTML = `<pre style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 6px; overflow-x: auto; color: #e2e8f0;">${summaryTableMd}</pre>`;
  }

  // Expose as window.__benchResults
  (window as unknown as { __benchResults: BenchResultsPayload }).__benchResults = fullPayload;

  // POST results to /eval-results/<label>-<model>-<timestamp>.json
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${label}-${model}-${safeTimestamp}.json`;
  logStatus("Saving results...", `POSTing to /eval-results/${filename}`);

  try {
    const postResp = await fetch(`/eval-results/${filename}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullPayload, null, 2),
    });
    if (postResp.ok) {
      logStatus("Benchmark Finished!", `Saved to asr-evaluation-assets/results/${filename} and updated RESULTS.md`);
    } else {
      logStatus("Benchmark Complete (Save Warning)", `POST returned ${postResp.status}: ${await postResp.text()}`);
    }
  } catch (postErr) {
    logStatus("Benchmark Complete (Save Failed)", String(postErr));
  }
}

// Auto-run if executed in browser environment
if (typeof window !== "undefined") {
  runBenchmark().catch((err) => {
    console.error("Benchmark failed:", err);
    const statusTitle = document.getElementById("status-title");
    const statusBox = document.getElementById("status-box");
    if (statusTitle) statusTitle.textContent = "Benchmark Error";
    if (statusBox) statusBox.textContent = err instanceof Error ? err.stack ?? err.message : String(err);
  });
}
