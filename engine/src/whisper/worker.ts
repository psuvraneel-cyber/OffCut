import { env as transformersEnv, pipeline } from "@huggingface/transformers";
import {
  openAudioProvider,
  PcmAudioWindowProvider,
  NeedsFallbackDecodeError,
  type AudioWindowProvider,
} from "../audio/decode";
import { AbortError, ModelLoadError, toEngineError } from "../errors";
import type {
  RawTimedText,
  Transcript,
  WindowTranscript,
} from "../types";
import type { WorkerRequest, WorkerResponse, WorkerRuntimeOptions } from "../protocol";
import { cleanSegments, cleanWords, groupWordsIntoSegments } from "./clean";
import { calculateRms, detectLanguage } from "./language";
import { mergeWindowTranscripts } from "./merge";
import { MODEL_CONFIG } from "./models";
import { createWindows } from "./windows";

type SpeechPipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>;

interface SpeechPipelineOutput {
  text?: string;
  language?: string;
  chunks?: Array<{
    text?: string;
    timestamp?: [number | null, number | null];
  }>;
}

interface ActiveRequest {
  id: number;
  controller: AbortController;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let speechPipeline: SpeechPipeline | null = null;
let loadedRuntime: WorkerRuntimeOptions | null = null;
let loadMs = 0;
let activeRequest: ActiveRequest | null = null;

transformersEnv.useBrowserCache = true;
transformersEnv.allowRemoteModels = true;
configureWasmThreads();

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(request: WorkerRequest): Promise<void> {
  if (request.type === "cancel") {
    if (activeRequest?.id === request.requestId) {
      activeRequest.controller.abort();
    }
    return;
  }

  if (request.type === "dispose") {
    await disposePipeline(true);
    send({ type: "disposed", requestId: request.requestId });
    return;
  }

  const controller = new AbortController();
  activeRequest = { id: request.requestId, controller };

  try {
    if (request.type === "load") {
      const runtime = await ensurePipeline(request.options, request.requestId, controller.signal);
      send({ type: "loaded", requestId: request.requestId, runtime });
      return;
    }

    const runtime = await ensurePipeline(request.runtime, request.requestId, controller.signal);

    if (request.type === "transcribe") {
      let provider: AudioWindowProvider;
      try {
        provider = await openAudioProvider(request.file);
      } catch (error) {
        if (error instanceof NeedsFallbackDecodeError) {
          send({ type: "needs-fallback-decode", requestId: request.requestId });
          return;
        }
        throw error;
      }

      const transcript = await runTranscription(
        provider,
        request.options.language ?? "auto",
        request.requestId,
        controller.signal,
        runtime,
      );
      send({ type: "result", requestId: request.requestId, transcript });
      return;
    }

    if (request.type === "transcribe-pcm") {
      const provider = new PcmAudioWindowProvider(request.pcm, request.sampleRate, request.duration);
      const transcript = await runTranscription(
        provider,
        request.options.language ?? "auto",
        request.requestId,
        controller.signal,
        runtime,
      );
      send({ type: "result", requestId: request.requestId, transcript });
      return;
    }
  } catch (error) {
    const normalized = toEngineError(error);
    const typedError = normalized.name === "AbortError" ? new AbortError() : normalized;
    send({
      type: "error",
      requestId: request.requestId,
      name: typedError.name,
      message: typedError.message,
    });
  } finally {
    if (activeRequest?.id === request.requestId) {
      activeRequest = null;
    }
  }
}

async function ensurePipeline(
  requestedRuntime: WorkerRuntimeOptions,
  requestId: number,
  signal: AbortSignal,
): Promise<WorkerRuntimeOptions> {
  if (speechPipeline && loadedRuntime && sameRuntime(loadedRuntime, requestedRuntime)) {
    return loadedRuntime;
  }

  await disposePipeline();
  throwIfAborted(signal);

  try {
    const startedAt = performance.now();
    const heartbeat = setInterval(() => {
      if (!signal.aborted) {
        send({ type: "progress", requestId, progress: { stage: "load" } });
      }
    }, 500);
    try {
      speechPipeline = await createPipeline(requestedRuntime, requestId, signal);
    } finally {
      clearInterval(heartbeat);
    }
    loadMs = performance.now() - startedAt;
    loadedRuntime = requestedRuntime;
    send({ type: "progress", requestId, progress: { stage: "load" } });
    return requestedRuntime;
  } catch (error) {
    if (requestedRuntime.device !== "webgpu") {
      throw new ModelLoadError(toEngineError(error).message);
    }

    send({ type: "progress", requestId, progress: { stage: "load" } });
    try {
      await disposePipeline();
      const fallbackRuntime: WorkerRuntimeOptions = { ...requestedRuntime, device: "wasm", dtype: "q8" };
      const startedAt = performance.now();
      speechPipeline = await createPipeline(fallbackRuntime, requestId, signal);
      loadMs = performance.now() - startedAt;
      loadedRuntime = fallbackRuntime;
      send({ type: "progress", requestId, progress: { stage: "load" } });
      return fallbackRuntime;
    } catch (fallbackError) {
      await disposePipeline();
      throw new ModelLoadError(toEngineError(fallbackError).message);
    }
  }
}

async function createPipeline(
  runtime: WorkerRuntimeOptions,
  requestId: number,
  signal: AbortSignal,
): Promise<SpeechPipeline> {
  throwIfAborted(signal);
  configureWasmThreads();
  const config = MODEL_CONFIG[runtime.model];
  if (!config) {
    throw new ModelLoadError("That Whisper model size is not available.");
  }

  const loaded = await pipeline("automatic-speech-recognition", config.id, {
    device: runtime.device,
    dtype: runtime.dtype as never,
    progress_callback: (info: unknown) => {
      const progress = normalizeDownloadProgress(info);
      if (progress) {
        send({ type: "progress", requestId, progress });
      } else {
        send({ type: "progress", requestId, progress: { stage: "load" } });
      }
    },
  });

  return loaded as unknown as SpeechPipeline;
}

async function runTranscription(
  provider: AudioWindowProvider,
  language: string,
  requestId: number,
  signal: AbortSignal,
  runtime: WorkerRuntimeOptions,
): Promise<Transcript> {
  if (!speechPipeline) {
    throw new ModelLoadError();
  }

  const processingStartedAt = performance.now();
  const duration = provider.duration;
  const windows = createWindows(duration);

  let decodeMs = 0;
  let transcribeMs = 0;
  let lastDecodeSeconds = 0;
  let lastTranscribeSeconds = 0;
  const windowResults: WindowTranscript[] = [];
  const preloadedAudio = new Map<number, Float32Array>();

  let latestProgress: Extract<WorkerResponse, { type: "progress" }>["progress"] = {
    stage: "decode",
    seconds: 0,
    duration,
  };
  const heartbeat = setInterval(() => {
    if (!signal.aborted) {
      sendProgress(requestId, latestProgress);
    }
  }, 400);

  function emitProgress(progress: Extract<WorkerResponse, { type: "progress" }>["progress"]): void {
    latestProgress = progress;
    sendProgress(requestId, progress);
  }

  let lockedLanguage = language;
  if (language === "auto") {
    if (windows.length === 0) {
      lockedLanguage = "en";
    } else {
      const w0StartedAt = performance.now();
      const w0Audio = await provider.getWindow(windows[0], signal);
      decodeMs += performance.now() - w0StartedAt;
      preloadedAudio.set(0, w0Audio);
      let detectionAudio = w0Audio;

      if (calculateRms(w0Audio) < 0.01) {
        for (let i = 1; i < Math.min(3, windows.length); i += 1) {
          throwIfAborted(signal);
          const wiStartedAt = performance.now();
          const wiAudio = await provider.getWindow(windows[i], signal);
          decodeMs += performance.now() - wiStartedAt;
          preloadedAudio.set(i, wiAudio);
          if (calculateRms(wiAudio) >= 0.01) {
            detectionAudio = wiAudio;
            break;
          }
        }
      }

      throwIfAborted(signal);
      const detectStartedAt = performance.now();
      try {
        lockedLanguage = await detectLanguage(speechPipeline, detectionAudio);
      } catch (detectError) {
        console.warn("Language detection failed, defaulting to en:", detectError);
        lockedLanguage = "en";
      }
      transcribeMs += performance.now() - detectStartedAt;
    }
  }

  try {
    for (const window of windows) {
      throwIfAborted(signal);
      emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });

      let audio: Float32Array;
      if (preloadedAudio.has(window.index)) {
        audio = preloadedAudio.get(window.index)!;
        preloadedAudio.delete(window.index);
      } else {
        const windowDecodeStartedAt = performance.now();
        audio = await provider.getWindow(window, signal, (seconds) => {
          lastDecodeSeconds = Math.max(lastDecodeSeconds, seconds);
          emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
        });
        decodeMs += performance.now() - windowDecodeStartedAt;
      }
      lastDecodeSeconds = Math.max(lastDecodeSeconds, window.end);
      emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });

      throwIfAborted(signal);
      emitProgress({ stage: "transcribe", seconds: lastTranscribeSeconds, duration });
      const windowTranscribeStartedAt = performance.now();

      const output = await speechPipeline(audio, {
        return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
        language: lockedLanguage,
        task: "transcribe",
      });

      throwIfAborted(signal);
      transcribeMs += performance.now() - windowTranscribeStartedAt;
      lastTranscribeSeconds = Math.max(lastTranscribeSeconds, window.end);
      emitProgress({ stage: "transcribe", seconds: lastTranscribeSeconds, duration });
      windowResults.push(parseWindowOutput(output, window, lockedLanguage));
    }
  } finally {
    clearInterval(heartbeat);
    provider.dispose();
  }

  const merged = mergeWindowTranscripts(windowResults, duration);
  const processingWallMs = performance.now() - processingStartedAt;

  // realTimeFactor: media seconds processed per wall-clock second of processing (excluding model load).
  const realTimeFactor = processingWallMs > 0 ? duration / (processingWallMs / 1000) : 0;

  return {
    language: lockedLanguage,
    duration,
    granularity: merged.granularity,
    segments: merged.segments,
    words: merged.words,
    stats: {
      model: runtime.model,
      device: runtime.device,
      dtype: runtime.dtype,
      loadMs,
      decodeMs,
      transcribeMs,
      realTimeFactor,
    },
  };
}

function parseWindowOutput(
  output: unknown,
  window: { index: number; start: number; end: number },
  requestedLanguage: string,
): WindowTranscript {
  const normalized = Array.isArray(output) ? output[0] : output;
  const result = (normalized ?? {}) as SpeechPipelineOutput;
  const chunks = Array.isArray(result.chunks) ? result.chunks : [];
  const language = typeof result.language === "string" ? result.language : requestedLanguage;
  const raw = chunks.map((chunk): RawTimedText => ({
    text: chunk.text ?? "",
    start: chunk.timestamp?.[0] ?? null,
    end: chunk.timestamp?.[1] ?? null,
  }));

  const hasUsableTimestamps = raw.some(
    (item) => typeof item.start === "number" && typeof item.end === "number",
  );
  if (!hasUsableTimestamps) {
    const text = typeof result.text === "string" ? result.text : "";
    const fallback = cleanSegments([{ text, start: 0, end: window.end - window.start }], window.end - window.start);
    return {
      window,
      granularity: "segment",
      language,
      segments: fallback,
      words: fallback.flatMap((segment) => segment.words),
    };
  }

  const words = cleanWords(raw, window.end - window.start);
  const segments = groupWordsIntoSegments(words);
  return { window, granularity: "word", language, segments, words };
}

function normalizeDownloadProgress(info: unknown): Extract<WorkerResponse, { type: "progress" }>['progress'] | null {
  if (!info || typeof info !== "object") {
    return null;
  }

  const candidate = info as { status?: string; file?: string; loaded?: number; total?: number };
  if (candidate.status !== "progress" || typeof candidate.file !== "string") {
    return null;
  }

  return {
    stage: "download",
    file: candidate.file,
    loaded: typeof candidate.loaded === "number" ? candidate.loaded : 0,
    total: typeof candidate.total === "number" ? candidate.total : 0,
  };
}

function sendProgress(requestId: number, progress: Extract<WorkerResponse, { type: "progress" }>['progress']): void {
  send({ type: "progress", requestId, progress });
}

function send(response: WorkerResponse): void {
  scope.postMessage(response);
}

function sameRuntime(left: WorkerRuntimeOptions, right: WorkerRuntimeOptions): boolean {
  return left.model === right.model && left.device === right.device && left.dtype === right.dtype;
}

function configureWasmThreads(): void {
  const onnx = transformersEnv.backends.onnx as unknown as { wasm?: { numThreads?: number } };
  onnx.wasm ??= {};
  onnx.wasm.numThreads = 1;
}

async function disposePipeline(abortActive = false): Promise<void> {
  if (abortActive) {
    activeRequest?.controller.abort();
    activeRequest = null;
  }
  const disposable = speechPipeline as (SpeechPipeline & { dispose?: () => void }) | null;
  disposable?.dispose?.();
  speechPipeline = null;
  loadedRuntime = null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError();
  }
}
