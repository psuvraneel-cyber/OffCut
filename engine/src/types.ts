export type ModelSize = "tiny" | "base" | "small";
export type Device = "auto" | "webgpu" | "wasm";
export type CaptionLanguage = "auto" | "en" | "hi" | "hinglish" | (string & {});

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
