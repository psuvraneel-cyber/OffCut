import type { ModelSize, Progress, Transcript, TranscribeOptions } from "./types";

export interface WorkerRuntimeOptions {
  model: ModelSize;
  device: "webgpu" | "wasm";
  dtype: string;
}

export type WorkerRequest =
  | {
      type: "load";
      requestId: number;
      options: WorkerRuntimeOptions;
    }
  | {
      type: "transcribe";
      requestId: number;
      file: Blob;
      options: Omit<TranscribeOptions, "signal" | "onProgress"> & { retry?: boolean };
      runtime: WorkerRuntimeOptions;
    }
  | {
      type: "transcribe-pcm";
      requestId: number;
      pcm: Float32Array;
      sampleRate: number;
      duration?: number;
      options: Omit<TranscribeOptions, "signal" | "onProgress"> & { retry?: boolean };
      runtime: WorkerRuntimeOptions;
    }
  | { type: "cancel"; requestId: number }
  | { type: "dispose"; requestId: number }
  // Destroys the worker's GPU device so tests can exercise GPU-loss recovery.
  | { type: "lose-gpu-for-testing"; requestId: number };

export type WorkerResponse =
  | { type: "progress"; requestId: number; progress: Progress }
  | { type: "loaded"; requestId: number; runtime: WorkerRuntimeOptions }
  | { type: "result"; requestId: number; transcript: Transcript }
  | { type: "error"; requestId: number; name: string; message: string }
  | { type: "disposed"; requestId: number }
  | { type: "gpu-lost"; requestId: number; reason: string; message: string }
  | { type: "needs-fallback-decode"; requestId: number };
