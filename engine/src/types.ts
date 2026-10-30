export type ModelSize = "tiny" | "base" | "small";
export type Device = "auto" | "webgpu" | "wasm";
export type CaptionLanguage = "auto" | "en" | "hi" | "hinglish" | (string & {});
export type ConditioningMode = "legacy" | "none" | "filter_only" | "norm_only";
export type WindowSplitStrategy = "baseline" | "fixed_duration" | "largest_pause" | "adaptive_pause";
export type DecodingProfile = "baseline" | "repetition_penalty" | "temperature" | "no_repeat_ngram" | "combined";
export type RecoveryStrategy = "none" | "legacy_bisect" | "ladder";

export interface TranscriberOptions {
  model?: ModelSize;
  device?: Device;
  defaultLanguage?: CaptionLanguage;
}

export interface TranscribeOptions {
  language?: CaptionLanguage;
  initialPrompt?: string;
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
  vad?: boolean;
  retry?: boolean;
  conditioning?: ConditioningMode;
  diagnostics?: boolean;
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
}

export type Progress =
  | { stage: "download"; file: string; loaded: number; total: number }
  | { stage: "load" }
  | { stage: "decode"; seconds: number; duration: number }
  | { stage: "transcribe"; seconds: number; duration: number };

export interface Word {
  text: string;
  start: number;
  end: number;
  kind?: "speech" | "cue";
}

export interface Segment {
  text: string;
  start: number;
  end: number;
  words: Word[];
}

export interface AudioStats {
  sampleCount: number;
  sampleRate: number;
  duration: number;
  rms: number;
  peak: number;
  min: number;
  max: number;
  nonFiniteCount: number;
  clippedCount: number;
  nearSilenceRatio: number;
}

export interface PipelineStageAttrition {
  stage: string;
  inputWords: number;
  outputWords: number;
  removedWords: number;
  retentionRate: number;
  notes?: string;
}

export interface DiagnosticWindowExecution {
  windowIndex: number;
  windowStart: number;
  windowEnd: number;
  duration: number;
  inputAudioStats: AudioStats;
  activeLanguage: string;
  pipelineOptions: {
    language: string;
    task: string;
    max_new_tokens: number;
    return_timestamps: unknown;
    initial_prompt?: string;
  };
  rawOutput: {
    text: string;
    chunkCount: number;
    chunks: Array<{ text: string; start: number | null; end: number | null }>;
  };
  parsedInitial: {
    wordCount: number;
    segmentCount: number;
    text: string;
    words: Array<{ text: string; start: number; end: number; kind?: "speech" | "cue" }>;
  };
  retryAssessment?: {
    flagged: boolean;
    reason?: string;
    speechSeconds: number;
    flaggedRegion?: { start: number; end: number };
  };
  retryExecution?: {
    attempted: boolean;
    strategy?: string;
    ladderCandidates?: Array<{
      id: string;
      valid: boolean;
      reason: string;
      wordCount: number;
      junkCount: number;
      foreignCount: number;
    }>;
    selectedCandidate?: string;
    half1?: {
      duration: number;
      language: string;
      rawText: string;
      wordCount: number;
      words: Array<{ text: string; start: number; end: number }>;
    };
    half2?: {
      duration: number;
      language: string;
      rawText: string;
      wordCount: number;
      words: Array<{ text: string; start: number; end: number }>;
    };
    mergedWordCount: number;
    accepted: boolean;
    acceptanceReason: string;
  };
  postProcessing: {
    inputWords: number;
    afterForeignScriptFilter: { count: number; removed: string[] };
    afterJunkFilter: { count: number; removed: string[] };
    afterRepetitionFilter: { count: number; removed: string[] };
    finalWords: number;
  };
}

export interface TranscriptionDiagnostics {
  diagnosticSchemaVersion: "1.0.0";
  enabled: boolean;
  media: {
    duration: number;
    audioStats?: AudioStats;
  };
  conditioningMode: ConditioningMode;
  vad: {
    status: "silero" | "failed" | "off";
    duration: number;
    blocksCount?: number;
    blocks?: Array<{
      index: number;
      start: number;
      end: number;
      frameCount: number;
      minProb: number;
      maxProb: number;
      meanProb: number;
    }>;
    speechSegments: Array<{ start: number; end: number }>;
    totalSpeechSeconds: number;
    speechCoverageRatio: number;
  };
  windowPlanning: {
    plannedWindows: Array<{ index: number; start: number; end: number }>;
    unionDuration: number;
    unionCoverageRatio: number;
  };
  windows: DiagnosticWindowExecution[];
  merging: {
    windowCount: number;
    inputTotalWords: number;
    cutPoints: Array<{
      windowA: number;
      windowB: number;
      cutSeconds: number;
      retainedA: number;
      retainedB: number;
      discardedA: number;
      discardedB: number;
    }>;
    totalAcceptedWords: number;
    finalNormalizedWords: number;
  };
  attritionSummary: PipelineStageAttrition[];
}

export interface Transcript {
  language: string;
  duration: number;
  granularity: "word" | "segment";
  segments: Segment[];
  words: Word[];
  stats: {
    model: ModelSize;
    device: "webgpu" | "wasm";
    dtype: string;
    loadMs: number;
    decodeMs: number;
    transcribeMs: number;
    realTimeFactor: number;
    vad?: "silero" | "off" | "failed";
    vadMs?: number;
    speechSeconds?: number;
    windows?: number;
    retriedWindows?: number;
    // Holds the VAD speech regions in seconds; only present when stats.vad is "silero".
    speechSegments?: { start: number; end: number }[];
  };
  diagnostics?: TranscriptionDiagnostics;
}

export interface Transcriber {
  load(onProgress?: (progress: Progress) => void): Promise<void>;
  transcribe(file: Blob, options?: TranscribeOptions): Promise<Transcript>;
  dispose(): void;
}

export interface CapabilityReport {
  webgpu: boolean;
  shaderF16: boolean;
  webcodecsAudio: boolean;
  recommendedModel: ModelSize;
  recommendedDevice: "webgpu" | "wasm";
}

export interface AudioWindow {
  index: number;
  start: number;
  end: number;
}

export interface WindowWord {
  text: string;
  start: number;
  end: number;
  kind?: "speech" | "cue";
}

export interface WindowSegment {
  text: string;
  start: number;
  end: number;
  words: WindowWord[];
}

export interface WindowTranscript {
  window: AudioWindow;
  granularity: "word" | "segment";
  language?: string;
  segments: WindowSegment[];
  words: WindowWord[];
}

export interface RawTimedText {
  text: string;
  start: number | null;
  end: number | null;
}
