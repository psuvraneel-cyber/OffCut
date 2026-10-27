import { detectCapabilities } from "./capabilities";
import {
  AbortError,
  GpuLostError,
  ModelLoadError,
  NoAudioTrackError,
  OutOfMemoryError,
  UnsupportedFormatError,
} from "./errors";
import { downmixToMono } from "./audio/resample";
import { chooseDtype } from "./whisper/models";
import type { WorkerRequest, WorkerResponse, WorkerRuntimeOptions } from "./protocol";
import type {
  CapabilityReport,
  CaptionLanguage,
  Device,
  ModelSize,
  Progress,
  Transcript,
  Transcriber,
  TranscriberOptions,
  TranscribeOptions,
} from "./types";

export type {
  CapabilityReport,
  CaptionLanguage,
  Device,
  ModelSize,
  Progress,
  Transcript,
  Transcriber,
  TranscriberOptions,
  TranscribeOptions,
  Word,
} from "./types";
export type { CaptionCue, CaptionOptions } from "./captions";
export type {
  NormalizedProgress,
  TranscriptionStageOptions,
} from "./stage.js";
export {
  AbortError,
  GpuLostError,
  ModelLoadError,
  NoAudioTrackError,
  OutOfMemoryError,
  UnsupportedFormatError,
} from "./errors";
export { detectCapabilities } from "./capabilities";
export {
  CAPTION_CONSTANTS,
  buildCaptionCues,
  toSrt,
  toVtt,
} from "./captions";
export {
  createTranscriptionStage,
  mapTranscriptionProgress,
} from "./stage.js";
export {
  DSP_CONSTANTS,
  applyHighPassFilter,
  normalizePeak,
  conditionAudio,
} from "./audio/dsp";
export {
  countForeignScriptWords,
  detectWordScript,
  filterForeignScriptWords,
  hasForeignScript,
  isWordAllowedInLanguage,
} from "./whisper/script";
export {
  transliterateDevanagariToHinglish,
  transliterateWord,
} from "./whisper/transliterate";

interface PendingRequest {
  file?: Blob;
  options?: TranscribeOptions;
  runtime?: WorkerRuntimeOptions;
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class BrowserTranscriber implements Transcriber {
  readonly #model: ModelSize;
  readonly #requestedDevice: Device;
  readonly #defaultLanguage?: CaptionLanguage;
  readonly #pending = new Map<number, PendingRequest>();
  #worker: Worker;
  #nextRequestId = 1;
  #runtime: WorkerRuntimeOptions | null = null;
  #capabilities: CapabilityReport | null = null;
  #isDisposed = false;
  #webgpuLost = false;

  constructor(options: TranscriberOptions = {}) {
    this.#model = options.model ?? "base";
    this.#requestedDevice = options.device ?? "auto";
    this.#defaultLanguage = options.defaultLanguage;
    this.#worker = this.createWorker();
  }

  async load(onProgress?: (progress: Progress) => void): Promise<void> {
    if (this.#isDisposed) {
      throw new Error("Transcriber has been disposed.");
    }
    const runtime = await this.resolveRuntime();
    await this.request(
      {
        type: "load",
        requestId: 0,
        options: runtime,
      },
      onProgress,
    );
  }

  async transcribe(file: Blob, options: TranscribeOptions = {}): Promise<Transcript> {
    if (this.#isDisposed) {
      throw new Error("Transcriber has been disposed.");
    }
    if (options.signal?.aborted) {
      throw new AbortError();
    }
    const runtime = await this.resolveRuntime();
    const requestId = this.#nextRequestId;
    const request: WorkerRequest = {
      type: "transcribe",
      requestId,
      file,
      options: {
        language: options.language ?? this.#defaultLanguage ?? "auto",
        initialPrompt: options.initialPrompt,
        vad: options.vad,
        retry: (options as { retry?: boolean }).retry,
      },
      runtime,
    };
    const result = await this.request(
      request,
      options.onProgress,
      options.signal,
      file,
      options,
      runtime,
    );
    const transcript = result as Transcript;
    this.#runtime = {
      model: this.#model,
      device: transcript.stats.device,
      dtype: transcript.stats.dtype,
    };
    return transcript;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(new AbortError("The transcriber was disposed."));
    }
    this.#pending.clear();
    this.#worker.terminate();
  }

  // Destroys the worker's GPU device to exercise GPU-loss recovery. Not part of the Transcriber interface.
  loseGpuForTesting(): void {
    this.#worker.postMessage({ type: "lose-gpu-for-testing", requestId: 0 } satisfies WorkerRequest);
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./whisper/worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      // Ignore anything a replaced worker sent before it was terminated.
      if (worker === this.#worker) {
        this.handleWorkerResponse(event.data);
      }
    });
    worker.addEventListener("error", (event) => {
      if (worker !== this.#worker) {
        return;
      }
      const error = new ModelLoadError(event.message || "The transcription worker stopped unexpectedly.");
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
    });
    return worker;
  }

  private handleWorkerResponse(response: WorkerResponse): void {
    if (response.type === "gpu-lost" || (response.type === "error" && response.name === "GpuLostError")) {
      this.handleGpuLost();
      return;
    }

    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      return;
    }

    if (response.type === "progress") {
      pending.onProgress?.(response.progress);
      return;
    }

    if (response.type === "needs-fallback-decode") {
      void this.handleFallbackDecode(response.requestId);
      return;
    }

    if (response.type === "loaded") {
      this.#runtime = response.runtime;
      pending.resolve(undefined);
      this.#pending.delete(response.requestId);
      return;
    }

    if (response.type === "result") {
      pending.resolve(response.transcript);
      this.#pending.delete(response.requestId);
      return;
    }

    if (response.type === "error") {
      pending.reject(createNamedError(response.name, response.message));
      this.#pending.delete(response.requestId);
    }
  }

  // A lost GPU device can never be used again, so the worker and its ONNX Runtime go with it.
  // Later runs on "auto" use the CPU; an explicit device: "webgpu" still tries the GPU.
  private handleGpuLost(): void {
    this.#webgpuLost = true;
    this.#runtime = null;
    this.#worker.terminate();
    for (const pending of this.#pending.values()) {
      pending.reject(new GpuLostError());
    }
    this.#pending.clear();
    this.#worker = this.createWorker();
  }

  private async handleFallbackDecode(requestId: number): Promise<void> {
    const pending = this.#pending.get(requestId);
    if (!pending || !pending.file) {
      return;
    }

    const file = pending.file;
    if (file.size > 200 * 1024 * 1024) {
      pending.reject(
        new OutOfMemoryError(
          "This format needs the browser fallback decoder, but the file is over 200 MB. Convert it to MP4, WebM, MP3, WAV, OGG, or FLAC first.",
        ),
      );
      this.#pending.delete(requestId);
      return;
    }

    pending.onProgress?.({ stage: "decode", seconds: 0, duration: 0 });

    try {
      if (pending.signal?.aborted) {
        throw new AbortError();
      }

      const arrayBuffer = await file.arrayBuffer();
      if (pending.signal?.aborted) {
        throw new AbortError();
      }

      const constructors = globalThis as typeof globalThis & {
        OfflineAudioContext?: typeof OfflineAudioContext;
        webkitOfflineAudioContext?: typeof OfflineAudioContext;
      };
      const OfflineAudioContextConstructor =
        constructors.OfflineAudioContext ?? constructors.webkitOfflineAudioContext;

      if (!OfflineAudioContextConstructor) {
        throw new UnsupportedFormatError(
          "This browser does not support OfflineAudioContext for fallback audio decoding.",
        );
      }

      const context = new OfflineAudioContextConstructor(1, 1, 16000);
      const audioBuffer = await context.decodeAudioData(arrayBuffer);

      if (audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
        throw new NoAudioTrackError();
      }

      const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
        audioBuffer.getChannelData(index),
      );
      const pcm = downmixToMono(channels);
      const duration = audioBuffer.duration;

      pending.onProgress?.({ stage: "decode", seconds: duration, duration });

      if (pending.signal?.aborted) {
        throw new AbortError();
      }

      const runtime = pending.runtime ?? (await this.resolveRuntime());
      const pcmRequest: WorkerRequest = {
        type: "transcribe-pcm",
        requestId,
        pcm,
        sampleRate: 16000,
        duration,
        options: {
          language: pending.options?.language ?? this.#defaultLanguage ?? "auto",
          initialPrompt: pending.options?.initialPrompt,
          vad: pending.options?.vad,
          retry: (pending.options as { retry?: boolean } | undefined)?.retry,
        },
        runtime,
      };

      this.#worker.postMessage(pcmRequest, [pcm.buffer]);
    } catch (error) {
      if (
        error instanceof AbortError ||
        error instanceof NoAudioTrackError ||
        error instanceof OutOfMemoryError
      ) {
        pending.reject(error);
      } else {
        pending.reject(
          new UnsupportedFormatError(
            "The browser fallback decoder could not read this file. Try MP4, WebM, MP3, WAV, OGG, or FLAC.",
          ),
        );
      }
      this.#pending.delete(requestId);
    }
  }

  private async request(
    request: WorkerRequest,
    onProgress?: (progress: Progress) => void,
    signal?: AbortSignal,
    file?: Blob,
    options?: TranscribeOptions,
    runtime?: WorkerRuntimeOptions,
  ): Promise<unknown> {
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    const message = { ...request, requestId } as WorkerRequest;

    return new Promise((resolve, reject) => {
      let abortHandler: (() => void) | undefined;
      const finish = (callback: () => void): void => {
        if (abortHandler && signal) {
          signal.removeEventListener("abort", abortHandler);
        }
        callback();
      };

      const pending: PendingRequest = {
        file,
        options,
        runtime,
        signal,
        onProgress,
        resolve: (value) => finish(() => resolve(value)),
        reject: (error) => finish(() => reject(error)),
      };
      this.#pending.set(requestId, pending);

      if (signal) {
        abortHandler = () => {
          this.#worker.terminate();
          for (const [id, req] of this.#pending.entries()) {
            if (id === requestId) {
              reject(new AbortError());
            } else {
              req.reject(new AbortError());
            }
          }
          this.#pending.clear();
          this.#worker = this.createWorker();
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      this.#worker.postMessage(message);
    });
  }

  private async resolveRuntime(): Promise<WorkerRuntimeOptions> {
    if (this.#runtime) {
      return this.#runtime;
    }

    this.#capabilities ??= await detectCapabilities();
    const device: "webgpu" | "wasm" =
      this.#requestedDevice === "wasm"
        ? "wasm"
        : this.#requestedDevice === "webgpu"
          ? "webgpu"
          : this.#webgpuLost
            ? "wasm"
            : this.#capabilities.recommendedDevice;
    const dtype = chooseDtype(device, this.#capabilities.shaderF16);
    return { model: this.#model, device, dtype };
  }
}

export function createTranscriber(options?: TranscriberOptions): Transcriber {
  return new BrowserTranscriber(options);
}

function createNamedError(name: string, message: string): Error {
  switch (name) {
    case "AbortError":
      return new AbortError(message);
    case "UnsupportedFormatError":
      return new UnsupportedFormatError(message);
    case "NoAudioTrackError":
      return new NoAudioTrackError(message);
    case "OutOfMemoryError":
      return new OutOfMemoryError(message);
    case "ModelLoadError":
      return new ModelLoadError(message);
    case "GpuLostError":
      return new GpuLostError(message);
    default:
      return new Error(message);
  }
}
