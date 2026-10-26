import { env as transformersEnv, pipeline } from "@huggingface/transformers";
import {
  openAudioProvider,
  PcmAudioWindowProvider,
  NeedsFallbackDecodeError,
  type AudioWindowProvider,
} from "../audio/decode";
import { AbortError, GpuLostError, ModelLoadError, toEngineError } from "../errors";
import type {
  AudioWindow,
  RawTimedText,
  TranscribeOptions,
  Transcript,
  WindowTranscript,
} from "../types";
import type { WorkerRequest, WorkerResponse, WorkerRuntimeOptions } from "../protocol";
import { cleanSegments, cleanWords, groupWordsIntoSegments } from "./clean";
import { calculateRms, detectLanguage } from "./language";
import { mergeWindowTranscripts } from "./merge";
import { MODEL_CONFIG, maxNewTokensFor, pipelineDtype } from "./models";
import { ortWasmPaths } from "./ort-assets";
import {
  SileroVadRunner,
  probabilitiesToSegments,
  VAD_CONSTANTS,
  type SpeechSegment,
} from "./vad";
import { planWindows, PLANNER_CONSTANTS, createWindows } from "./windows";
import {
  assessWindow,
  RETRY_CONSTANTS,
  countJunkWords,
  hasRepetitionLoop,
  normalizeToken,
  removeJunkWords,
  removeRepetitionLoops,
} from "./retry";

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
let vadRunner: SileroVadRunner | null = null;
let loadedRuntime: WorkerRuntimeOptions | null = null;
let loadMs = 0;
let activeRequest: ActiveRequest | null = null;
let gpuDevice: WatchedGpuDevice | null = null;
let gpuLost = false;

const GPU_LOSS_CHECK_MS = 250;

transformersEnv.useBrowserCache = true;
transformersEnv.allowRemoteModels = true;
configureWasmThreads();

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data);
});

// When the GPU device is lost, ORT's pending buffer reads reject inside ORT, where nothing awaits them.
// The loss itself is reported through "gpu-lost", so these leftovers are expected noise.
scope.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const reason = event.reason as { name?: string; message?: string } | undefined;
  if (gpuDevice && reason?.name === "AbortError" && reason.message?.includes("GPUBuffer")) {
    event.preventDefault();
  }
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

  if (request.type === "lose-gpu-for-testing") {
    gpuDevice?.destroy();
    return;
  }

  const controller = new AbortController();
  activeRequest = { id: request.requestId, controller };

  try {
    if (gpuLost) {
      throw new GpuLostError();
    }

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
        request.options,
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
        request.options,
      );
      send({ type: "result", requestId: request.requestId, transcript });
      return;
    }
  } catch (error) {
    const normalized = toEngineError(error);
    const typedError =
      normalized.name === "AbortError"
        ? new AbortError()
        : normalized.name !== "GpuLostError" && (await isGpuLost())
          ? new GpuLostError()
          : normalized;
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
    if (requestedRuntime.device === "webgpu") {
      await watchGpuDevice();
    }
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
    dtype: pipelineDtype(runtime.dtype) as never,
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

// Junk words and repetition loops never reach captions, even when a retry didn't fix them.
function sanitizeWindowResult(result: WindowTranscript): WindowTranscript {
  if (result.granularity !== "word") {
    return result;
  }
  const words = removeRepetitionLoops(removeJunkWords(result.words));
  if (words.length === result.words.length) {
    return result;
  }
  return { ...result, words, segments: groupWordsIntoSegments(words) };
}

function countWordsInRegion(
  words: readonly { start: number; end: number }[],
  region: { start: number; end: number },
): number {
  return words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return mid >= region.start && mid <= region.end;
  }).length;
}

function calculateRmsSegments(audio: Float32Array, sampleRate = 16000, frameSize = 512): SpeechSegment[] {
  const frameCount = Math.floor(audio.length / frameSize);
  if (frameCount === 0) return [];
  const probs = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sumSquares = 0;
    const offset = f * frameSize;
    for (let i = 0; i < frameSize; i++) {
      const val = audio[offset + i];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / frameSize);
    probs[f] = rms >= 0.01 ? 1.0 : 0.0;
  }
  const winDuration = audio.length / sampleRate;
  return probabilitiesToSegments(probs, VAD_CONSTANTS, winDuration);
}

async function ensureVadRunner(): Promise<SileroVadRunner> {
  if (!vadRunner) {
    vadRunner = new SileroVadRunner();
  }
  await vadRunner.load();
  return vadRunner;
}

async function runTranscription(
  provider: AudioWindowProvider,
  language: string,
  requestId: number,
  signal: AbortSignal,
  runtime: WorkerRuntimeOptions,
  options: Omit<TranscribeOptions, "signal" | "onProgress"> & { retry?: boolean } = {},
): Promise<Transcript> {
  if (!speechPipeline) {
    throw new ModelLoadError();
  }

  const processingStartedAt = performance.now();
  const duration = provider.duration;

  let decodeMs = 0;
  let transcribeMs = 0;
  let vadMs = 0;
  let speechSeconds = 0;
  let retriedWindows = 0;
  let lastDecodeSeconds = 0;
  let lastTranscribeSeconds = 0;

  let vadStatus: "silero" | "failed" | "off" = "silero";
  let windows: AudioWindow[] = [];
  let allProbs = new Float32Array(0);
  let segments: SpeechSegment[] = [];

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

  // --- PASS 1: VAD and Window Planning ---
  if (options.vad === false) {
    vadStatus = "off";
    windows = createWindows(duration);
  } else {
    try {
      const runner = await ensureVadRunner();
      runner.reset();

      const probChunks: Float32Array[] = [];
      const BLOCK_SIZE = 30;
      let blockStart = 0;
      let blockIndex = 0;

      while (blockStart < duration) {
        throwIfAborted(signal);
        const blockEnd = Math.min(duration, blockStart + BLOCK_SIZE);
        const blockWindow: AudioWindow = { index: blockIndex, start: blockStart, end: blockEnd };
        const isLast = blockEnd >= duration;

        const dStart = performance.now();
        const chunkAudio = await provider.getWindow(blockWindow, signal, (sec) => {
          lastDecodeSeconds = Math.max(lastDecodeSeconds, Math.min(duration, sec));
          emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
        });
        decodeMs += performance.now() - dStart;
        lastDecodeSeconds = Math.max(lastDecodeSeconds, blockEnd);
        emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });

        throwIfAborted(signal);
        const vStart = performance.now();
        const chunkProbs = await runner.processChunk(chunkAudio, isLast);
        vadMs += performance.now() - vStart;
        probChunks.push(chunkProbs);

        blockStart = blockEnd;
        blockIndex++;
      }

      const totalFrames = probChunks.reduce((acc, c) => acc + c.length, 0);
      allProbs = new Float32Array(totalFrames);
      let pOffset = 0;
      for (const c of probChunks) {
        allProbs.set(c, pOffset);
        pOffset += c.length;
      }

      segments = probabilitiesToSegments(allProbs, VAD_CONSTANTS, duration);
      windows = planWindows(segments, allProbs, duration, PLANNER_CONSTANTS);
      speechSeconds = segments.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
    } catch (vadError) {
      if (signal.aborted) {
        throw vadError;
      }
      console.warn("VAD failed, falling back to fixed windows:", vadError);
      vadStatus = "failed";
      windows = createWindows(duration);
    }
  }

  const windowResults: WindowTranscript[] = [];
  const preloadedAudio = new Map<number, Float32Array>();

  // --- LANGUAGE DETECTION ---
  let lockedLanguage = language;
  if (language === "auto") {
    if (windows.length === 0) {
      lockedLanguage = "en";
    } else {
      const w0 = windows[0];
      const w0StartedAt = performance.now();
      const w0Audio = await provider.getWindow(w0, signal);
      decodeMs += performance.now() - w0StartedAt;
      preloadedAudio.set(w0.index, w0Audio);
      let detectionAudio = w0Audio;

      if (vadStatus !== "silero" && calculateRms(w0Audio) < 0.01) {
        for (let i = 1; i < Math.min(3, windows.length); i += 1) {
          throwIfAborted(signal);
          const wi = windows[i];
          const wiStartedAt = performance.now();
          const wiAudio = await provider.getWindow(wi, signal);
          decodeMs += performance.now() - wiStartedAt;
          preloadedAudio.set(wi.index, wiAudio);
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

  // --- PASS 2: Transcribe Planned Windows & Retry ---
  const retryEnabled = options.retry !== false;

  try {
    for (const window of windows) {
      throwIfAborted(signal);

      let audio: Float32Array;
      if (preloadedAudio.has(window.index)) {
        audio = preloadedAudio.get(window.index)!;
        preloadedAudio.delete(window.index);
      } else if (vadStatus === "off" || vadStatus === "failed") {
        emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
        const windowDecodeStartedAt = performance.now();
        audio = await provider.getWindow(window, signal, (seconds) => {
          lastDecodeSeconds = Math.max(lastDecodeSeconds, seconds);
          emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
        });
        decodeMs += performance.now() - windowDecodeStartedAt;
        lastDecodeSeconds = Math.max(lastDecodeSeconds, window.end);
        emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
      } else {
        const windowDecodeStartedAt = performance.now();
        audio = await provider.getWindow(window, signal);
        decodeMs += performance.now() - windowDecodeStartedAt;
      }

      throwIfAborted(signal);
      emitProgress({ stage: "transcribe", seconds: lastTranscribeSeconds, duration });
      const windowTranscribeStartedAt = performance.now();

      const output = await speechPipeline(audio, {
        return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
        language: lockedLanguage,
        task: "transcribe",
        max_new_tokens: maxNewTokensFor(audio.length / 16000),
      });

      throwIfAborted(signal);
      transcribeMs += performance.now() - windowTranscribeStartedAt;
      let windowResult = parseWindowOutput(output, window, lockedLanguage);

      if (retryEnabled) {
        let segmentsInWindow: SpeechSegment[];
        if (vadStatus === "silero") {
          segmentsInWindow = segments
            .filter((s) => s.end > window.start && s.start < window.end)
            .map((s) => ({
              start: Math.max(0, s.start - window.start),
              end: Math.min(window.end - window.start, s.end - window.start),
            }));
        } else {
          // Brief C1: for vad: false / failed, estimate speech from per-frame RMS >= 0.01
          segmentsInWindow = calculateRmsSegments(audio);
        }

        const assess = assessWindow(windowResult, segmentsInWindow, RETRY_CONSTANTS);

        if (assess.flagged) {
          const retryStartedAt = performance.now();
          const winDur = window.end - window.start;

          if (winDur >= 1.0) {
            const midSec = window.start + winDur / 2;
            const frameSec = VAD_CONSTANTS.frameSize / VAD_CONSTANTS.sampleRate;

            let half1EndRel: number;
            let half2StartRel: number;

            if (vadStatus === "silero" && allProbs.length > 0) {
              const searchStartSec = Math.max(window.start + 0.5, midSec - 3);
              const searchEndSec = Math.min(window.end - 0.5, midSec + 3);
              const startFrame = Math.max(0, Math.floor(searchStartSec / frameSec));
              const endFrame = Math.min(allProbs.length - 1, Math.floor(searchEndSec / frameSec));

              let minProb = Infinity;
              let minFrame = -1;
              for (let f = startFrame; f <= endFrame; f++) {
                if (allProbs[f] < minProb) {
                  minProb = allProbs[f];
                  minFrame = f;
                }
              }

              if (minFrame !== -1 && minProb < VAD_CONSTANTS.negThreshold) {
                const splitSecAbs = minFrame * frameSec;
                half1EndRel = Math.max(0.2, Math.min(winDur - 0.2, splitSecAbs - window.start));
                half2StartRel = half1EndRel;
              } else {
                const midRel = winDur / 2;
                half1EndRel = Math.min(winDur, winDur > 2 ? midRel + 0.5 : midRel);
                half2StartRel = Math.max(0, winDur > 2 ? midRel - 0.5 : midRel);
              }
            } else {
              // RMS fallback / vad: false split
              const midRel = winDur / 2;
              half1EndRel = Math.min(winDur, winDur > 2 ? midRel + 0.5 : midRel);
              half2StartRel = Math.max(0, winDur > 2 ? midRel - 0.5 : midRel);
            }

            const half1Samples = Math.round(half1EndRel * 16000);
            const half2StartSample = Math.round(half2StartRel * 16000);
            const half1Audio = audio.subarray(0, half1Samples).slice();
            const half2Audio = audio.subarray(half2StartSample).slice();

            if (half1Audio.length > 0 && half2Audio.length > 0) {
              const out1 = await speechPipeline(half1Audio, {
                return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                language: lockedLanguage,
                task: "transcribe",
                max_new_tokens: maxNewTokensFor(half1Audio.length / 16000),
              });
              const out2 = await speechPipeline(half2Audio, {
                return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                language: lockedLanguage,
                task: "transcribe",
                max_new_tokens: maxNewTokensFor(half2Audio.length / 16000),
              });

              const half1Res = parseWindowOutput(out1, { index: 0, start: 0, end: half1EndRel }, lockedLanguage);
              const half2Res = parseWindowOutput(out2, { index: 1, start: half2StartRel, end: winDur }, lockedLanguage);
              const retryMerged = mergeWindowTranscripts([half1Res, half2Res], winDur);

              const retryTokens = retryMerged.words.map((w) => normalizeToken(w.text)).filter(Boolean);
              const retryHasLoop = hasRepetitionLoop(retryTokens);

              let accepted = false;
              if (!retryHasLoop) {
                if (assess.reason === "repetition_loop") {
                  accepted = true;
                } else if (assess.reason === "junk_output") {
                  accepted = countJunkWords(retryMerged.words) < countJunkWords(windowResult.words);
                } else if (assess.flaggedRegion) {
                  const origCount = countWordsInRegion(windowResult.words, assess.flaggedRegion);
                  const retryCount = countWordsInRegion(retryMerged.words, assess.flaggedRegion);
                  accepted = retryCount > origCount;
                } else {
                  accepted = retryMerged.words.length > windowResult.words.length;
                }
              }

              if (accepted) {
                windowResult = {
                  window,
                  granularity: retryMerged.granularity,
                  language: lockedLanguage,
                  segments: retryMerged.segments.map((s) => ({
                    text: s.text,
                    start: s.start,
                    end: s.end,
                    words: s.words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(w.kind ? { kind: w.kind } : {}) })),
                  })),
                  words: retryMerged.words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(w.kind ? { kind: w.kind } : {}) })),
                };
              }
              retriedWindows++;
            }
          }
          transcribeMs += performance.now() - retryStartedAt;
        }
      }

      lastTranscribeSeconds = Math.max(lastTranscribeSeconds, window.end);
      emitProgress({ stage: "transcribe", seconds: lastTranscribeSeconds, duration });
      windowResults.push(sanitizeWindowResult(windowResult));
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
      vad: vadStatus,
      vadMs: vadStatus === "silero" ? vadMs : undefined,
      speechSeconds: vadStatus === "silero" ? speechSeconds : undefined,
      windows: windows.length,
      retriedWindows,
      speechSegments: vadStatus === "silero" ? segments : undefined,
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
  const onnx = transformersEnv.backends.onnx as unknown as {
    wasm?: { numThreads?: number; wasmPaths?: unknown };
  };
  onnx.wasm ??= {};
  onnx.wasm.numThreads = 1;
  onnx.wasm.wasmPaths = ortWasmPaths(scope.location.href);
}

async function disposePipeline(abortActive = false): Promise<void> {
  if (abortActive) {
    activeRequest?.controller.abort();
    activeRequest = null;
  }
  const disposable = speechPipeline as (SpeechPipeline & { dispose?: () => Promise<unknown> }) | null;
  const vad = vadRunner;
  speechPipeline = null;
  loadedRuntime = null;
  vadRunner = null;
  // Release every session: ORT frees its WebGPU buffer cache only once none is left.
  await Promise.allSettled([disposable?.dispose?.(), vad?.dispose()]);
}

interface WatchedGpuDevice {
  lost: Promise<{ reason: string; message: string }>;
  destroy(): void;
}

// After the first WebGPU session exists, ORT exposes the device it created as env.webgpu.device
// (onnxruntime-web lib/wasm/jsep/backend-webgpu.ts, lines 277–282). Reading it earlier would create a new device.
async function watchGpuDevice(): Promise<void> {
  const onnx = transformersEnv.backends.onnx as unknown as { webgpu?: { device?: unknown } };
  const device = (await onnx.webgpu?.device) as WatchedGpuDevice | undefined;
  if (!device || device === gpuDevice) {
    return;
  }
  gpuDevice = device;
  void device.lost.then((info) => {
    gpuLost = true;
    send({
      type: "gpu-lost",
      requestId: activeRequest?.id ?? 0,
      reason: info.reason,
      message: info.message,
    });
  });
}

// An inference error can arrive just before the device's lost promise settles.
async function isGpuLost(): Promise<boolean> {
  if (gpuLost || !gpuDevice) {
    return gpuLost;
  }
  const lost = await Promise.race([
    gpuDevice.lost.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), GPU_LOSS_CHECK_MS)),
  ]);
  return lost;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError();
  }
}
