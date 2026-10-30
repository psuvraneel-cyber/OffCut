import { env as transformersEnv, pipeline } from "@huggingface/transformers";
import {
  openAudioProvider,
  PcmAudioWindowProvider,
  NeedsFallbackDecodeError,
  type AudioWindowProvider,
} from "../audio/decode";
import { measureAudioStats } from "../audio/dsp";
import { AbortError, GpuLostError, ModelLoadError, toEngineError } from "../errors";
import type {
  AudioWindow,
  CaptionLanguage,
  DiagnosticWindowExecution,
  RawTimedText,
  TranscribeOptions,
  Transcript,
  TranscriptionDiagnostics,
  WindowTranscript,
} from "../types";
import type { WorkerRequest, WorkerResponse, WorkerRuntimeOptions } from "../protocol";
import { cleanSegments, cleanWords, groupWordsIntoSegments } from "./clean";
import { calculateRms, detectLanguage } from "./language";
import { countForeignScriptWords, filterForeignScriptWords } from "./script";
import { transliterateDevanagariToHinglish } from "./transliterate";
import { mergeWindowTranscripts, type MergeDiagnosticInfo } from "./merge";
import { MODEL_CONFIG, maxNewTokensFor, pipelineDtype } from "./models";
import { ortWasmPaths } from "./ort-assets";
import {
  SileroVadRunner,
  probabilitiesToSegments,
  VAD_CONSTANTS,
  type SpeechSegment,
} from "./vad";
import {
  planWindows,
  createWindows,
  calculateIntervalUnionDuration,
  WINDOW_SECONDS,
  OVERLAP_SECONDS,
  type WindowPlanningOptions,
} from "./windows";
import {
  assessWindow,
  RETRY_CONSTANTS,
  countJunkWords,
  hasRepetitionLoop,
  normalizeToken,
  removeJunkWords,
  removeRepetitionLoops,
  validateCandidateTranscript,
  type CandidateValidationResult,
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
export const DEFAULT_HINGLISH_PROMPT = "";

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
function sanitizeWindowResult(
  result: WindowTranscript,
  targetLanguage: CaptionLanguage = "auto",
  recordDiagnostic?: (diag: {
    inputWords: number;
    afterForeignScriptFilter: { count: number; removed: string[] };
    afterJunkFilter: { count: number; removed: string[] };
    afterRepetitionFilter: { count: number; removed: string[] };
    finalWords: number;
  }) => void,
): WindowTranscript {
  const inputWords = result.words.length;
  const cleanScriptWords = filterForeignScriptWords(result.words, targetLanguage);
  const removedScript = result.words
    .filter((w) => !cleanScriptWords.includes(w))
    .map((w) => w.text);

  const afterJunkWords = removeJunkWords(cleanScriptWords, targetLanguage);
  const removedJunk = cleanScriptWords
    .filter((w) => !afterJunkWords.includes(w))
    .map((w) => w.text);

  const sanitizedWords = removeRepetitionLoops(afterJunkWords);
  const removedRepCount = afterJunkWords.length - sanitizedWords.length;
  const removedRep = removedRepCount > 0 ? [`${removedRepCount} words removed in repetition loops`] : [];

  if (recordDiagnostic) {
    recordDiagnostic({
      inputWords,
      afterForeignScriptFilter: { count: cleanScriptWords.length, removed: removedScript },
      afterJunkFilter: { count: afterJunkWords.length, removed: removedJunk },
      afterRepetitionFilter: { count: sanitizedWords.length, removed: removedRep },
      finalWords: sanitizedWords.length,
    });
  }

  if (sanitizedWords.length === 0) {
    return { ...result, words: [], segments: [] };
  }
  if (sanitizedWords.length === result.words.length && result.granularity === "word") {
    return result;
  }
  return { ...result, granularity: "word", words: sanitizedWords, segments: groupWordsIntoSegments(sanitizedWords) };
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

  const diagnostics: TranscriptionDiagnostics | undefined = options.diagnostics
    ? {
        diagnosticSchemaVersion: "1.0.0",
        enabled: true,
        media: { duration },
        conditioningMode: options.conditioning ?? "legacy",
        vad: {
          status: vadStatus,
          duration,
          blocksCount: 0,
          blocks: [],
          speechSegments: [],
          totalSpeechSeconds: 0,
          speechCoverageRatio: 0,
        },
        windowPlanning: {
          plannedWindows: [],
          unionDuration: 0,
          unionCoverageRatio: 0,
        },
        windows: [],
        merging: {
          windowCount: 0,
          inputTotalWords: 0,
          cutPoints: [],
          totalAcceptedWords: 0,
          finalNormalizedWords: 0,
        },
        attritionSummary: [],
      }
    : undefined;

  const windowPlanningOpts: WindowPlanningOptions = {
    maxWindowSeconds: options.maxWindowSeconds,
    forcedOverlapSeconds: options.windowOverlapSeconds,
    splitStrategy: options.windowPolicy,
    minimumSplitPauseSeconds: options.minSplitPauseSeconds,
  };

  // --- PASS 1: VAD and Window Planning ---
  if (options.vad === false) {
    vadStatus = "off";
    windows = createWindows(
      duration,
      options.maxWindowSeconds ?? WINDOW_SECONDS,
      options.windowOverlapSeconds ?? OVERLAP_SECONDS,
    );
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
        const chunkAudio = await provider.getWindow(
          blockWindow,
          signal,
          (sec) => {
            lastDecodeSeconds = Math.max(lastDecodeSeconds, Math.min(duration, sec));
            emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
          },
          options.conditioning,
        );
        decodeMs += performance.now() - dStart;
        lastDecodeSeconds = Math.max(lastDecodeSeconds, blockEnd);
        emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });

        throwIfAborted(signal);
        const vStart = performance.now();
        const chunkProbs = await runner.processChunk(chunkAudio, isLast);
        vadMs += performance.now() - vStart;
        probChunks.push(chunkProbs);

        if (diagnostics && diagnostics.vad.blocks) {
          let minP = Infinity;
          let maxP = -Infinity;
          let sumP = 0;
          for (let p = 0; p < chunkProbs.length; p++) {
            const val = chunkProbs[p];
            if (val < minP) minP = val;
            if (val > maxP) maxP = val;
            sumP += val;
          }
          diagnostics.vad.blocks.push({
            index: blockIndex,
            start: blockStart,
            end: blockEnd,
            frameCount: chunkProbs.length,
            minProb: chunkProbs.length > 0 ? minP : 0,
            maxProb: chunkProbs.length > 0 ? maxP : 0,
            meanProb: chunkProbs.length > 0 ? sumP / chunkProbs.length : 0,
          });
        }

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
      windows = planWindows(segments, allProbs, duration, windowPlanningOpts);
      speechSeconds = segments.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
    } catch (vadError) {
      if (signal.aborted) {
        throw vadError;
      }
      console.warn("VAD failed, falling back to fixed windows:", vadError);
      vadStatus = "failed";
      windows = createWindows(
        duration,
        options.maxWindowSeconds ?? WINDOW_SECONDS,
        options.windowOverlapSeconds ?? OVERLAP_SECONDS,
      );
    }
  }

  if (diagnostics) {
    diagnostics.vad.status = vadStatus;
    diagnostics.vad.blocksCount = diagnostics.vad.blocks?.length ?? 0;
    diagnostics.vad.speechSegments = segments.map((s) => ({ start: s.start, end: s.end }));
    diagnostics.vad.totalSpeechSeconds = speechSeconds;
    diagnostics.vad.speechCoverageRatio = duration > 0 ? speechSeconds / duration : 0;
    diagnostics.windowPlanning.plannedWindows = windows.map((w) => ({ index: w.index, start: w.start, end: w.end }));
    diagnostics.windowPlanning.unionDuration = calculateIntervalUnionDuration(windows);
    diagnostics.windowPlanning.unionCoverageRatio =
      duration > 0 ? diagnostics.windowPlanning.unionDuration / duration : 0;
  }

  const windowResults: WindowTranscript[] = [];
  const preloadedAudio = new Map<number, Float32Array>();

  // --- LANGUAGE DETECTION & PROMPT BIASING ---
  const isHinglish = language === "hinglish";
  const targetLanguage = isHinglish ? "hi" : language;
  const initialPrompt = options.initialPrompt ?? undefined;

  let lockedLanguage = targetLanguage;
  if (targetLanguage === "auto") {
    if (windows.length === 0) {
      lockedLanguage = "en";
    } else {
      const w0 = windows[0];
      const w0StartedAt = performance.now();
      const w0Audio = await provider.getWindow(w0, signal, undefined, options.conditioning);
      decodeMs += performance.now() - w0StartedAt;
      preloadedAudio.set(w0.index, w0Audio);
      let detectionAudio = w0Audio;

      if (vadStatus !== "silero" && calculateRms(w0Audio) < 0.01) {
        for (let i = 1; i < Math.min(3, windows.length); i += 1) {
          throwIfAborted(signal);
          const wi = windows[i];
          const wiStartedAt = performance.now();
          const wiAudio = await provider.getWindow(wi, signal, undefined, options.conditioning);
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
        lockedLanguage = await detectLanguage(speechPipeline, detectionAudio, { coerceHindustani: true });
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
        audio = await provider.getWindow(
          window,
          signal,
          (seconds) => {
            lastDecodeSeconds = Math.max(lastDecodeSeconds, seconds);
            emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
          },
          options.conditioning,
        );
        decodeMs += performance.now() - windowDecodeStartedAt;
        lastDecodeSeconds = Math.max(lastDecodeSeconds, window.end);
        emitProgress({ stage: "decode", seconds: lastDecodeSeconds, duration });
      } else {
        const windowDecodeStartedAt = performance.now();
        audio = await provider.getWindow(window, signal, undefined, options.conditioning);
        decodeMs += performance.now() - windowDecodeStartedAt;
      }

      // Dynamic language handling for Hinglish and Auto mode
      let activeWindowLanguage = lockedLanguage;
      if (isHinglish) {
        if (calculateRms(audio) >= 0.01) {
          try {
            const detected = await detectLanguage(speechPipeline, audio, {
              candidates: ["en", "hi", "ur"],
              coerceHindustani: true,
            });
            activeWindowLanguage = detected === "en" ? "en" : "hi";
          } catch {
            activeWindowLanguage = "hi";
          }
        } else {
          activeWindowLanguage = "hi";
        }
      } else if (targetLanguage === "auto" && window.index > 0 && calculateRms(audio) >= 0.01) {
        try {
          activeWindowLanguage = await detectLanguage(speechPipeline, audio, { coerceHindustani: true });
        } catch {
          activeWindowLanguage = lockedLanguage;
        }
      }

      throwIfAborted(signal);
      emitProgress({ stage: "transcribe", seconds: lastTranscribeSeconds, duration });
      const windowTranscribeStartedAt = performance.now();

      const pipelineOptions: Record<string, unknown> = {
        return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
        language: activeWindowLanguage,
        task: "transcribe",
        max_new_tokens: maxNewTokensFor(audio.length / 16000),
      };
      if (initialPrompt) {
        pipelineOptions.initial_prompt = initialPrompt;
      }
      if (options.repetitionPenalty !== undefined || options.decodingProfile === "repetition_penalty" || options.decodingProfile === "combined") {
        pipelineOptions.repetition_penalty = options.repetitionPenalty ?? 1.15;
      }
      if (options.noRepeatNgramSize !== undefined || options.decodingProfile === "no_repeat_ngram" || options.decodingProfile === "combined") {
        pipelineOptions.no_repeat_ngram_size = options.noRepeatNgramSize ?? 3;
      }
      if (options.temperature !== undefined || options.decodingProfile === "temperature") {
        pipelineOptions.temperature = options.temperature ?? 0.3;
        pipelineOptions.do_sample = options.doSample ?? true;
      } else if (options.doSample !== undefined) {
        pipelineOptions.do_sample = options.doSample;
      }

      const winDiag: DiagnosticWindowExecution | undefined = diagnostics
        ? {
            windowIndex: window.index,
            windowStart: window.start,
            windowEnd: window.end,
            duration: window.end - window.start,
            inputAudioStats: measureAudioStats(audio),
            activeLanguage: activeWindowLanguage,
            pipelineOptions: {
              language: activeWindowLanguage,
              task: "transcribe",
              max_new_tokens: maxNewTokensFor(audio.length / 16000),
              return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
              initial_prompt: initialPrompt,
              ...(pipelineOptions.repetition_penalty ? { repetition_penalty: pipelineOptions.repetition_penalty } : {}),
              ...(pipelineOptions.no_repeat_ngram_size ? { no_repeat_ngram_size: pipelineOptions.no_repeat_ngram_size } : {}),
              ...(pipelineOptions.temperature ? { temperature: pipelineOptions.temperature } : {}),
              ...(pipelineOptions.do_sample ? { do_sample: pipelineOptions.do_sample } : {}),
            },
            rawOutput: { text: "", chunkCount: 0, chunks: [] },
            parsedInitial: { wordCount: 0, segmentCount: 0, text: "", words: [] },
            postProcessing: {
              inputWords: 0,
              afterForeignScriptFilter: { count: 0, removed: [] },
              afterJunkFilter: { count: 0, removed: [] },
              afterRepetitionFilter: { count: 0, removed: [] },
              finalWords: 0,
            },
          }
        : undefined;

      const output = await speechPipeline(audio, pipelineOptions);

      throwIfAborted(signal);
      transcribeMs += performance.now() - windowTranscribeStartedAt;

      if (winDiag) {
        const normOut = (Array.isArray(output) ? output[0] : output) as SpeechPipelineOutput | undefined;
        const rawText = typeof normOut?.text === "string" ? normOut.text : "";
        const rawChunks = Array.isArray(normOut?.chunks)
          ? normOut.chunks.map((c) => ({
              text: c.text ?? "",
              start: c.timestamp?.[0] ?? null,
              end: c.timestamp?.[1] ?? null,
            }))
          : [];
        winDiag.rawOutput = { text: rawText, chunkCount: rawChunks.length, chunks: rawChunks };
      }

      let windowResult = parseWindowOutput(output, window, isHinglish ? "hinglish" : activeWindowLanguage);

      if (winDiag) {
        winDiag.parsedInitial = {
          wordCount: windowResult.words.length,
          segmentCount: windowResult.segments.length,
          text: windowResult.words.map((w) => w.text).join(" "),
          words: windowResult.words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(w.kind ? { kind: w.kind } : {}) })),
        };
      }

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

        if (winDiag) {
          winDiag.retryAssessment = {
            flagged: assess.flagged,
            reason: assess.reason,
            speechSeconds: assess.speechSeconds,
            flaggedRegion: assess.flaggedRegion,
          };
        }

        const recoveryStrategy = options.recoveryStrategy ?? "ladder";

        if (assess.flagged && recoveryStrategy !== "none") {
          const retryStartedAt = performance.now();
          const winDur = window.end - window.start;

          // If foreign script was detected or speech was dropped (too few words, stopped early, started late,
          // skipped speech, junk) in English mode on a bilingual/auto video, re-anchor to Hindi
          let retryLanguage = activeWindowLanguage;
          if (
            assess.reason === "foreign_script" ||
            ((isHinglish || targetLanguage === "auto") &&
              activeWindowLanguage === "en" &&
              (assess.reason === "too_few_words" ||
                assess.reason === "stopped_early" ||
                assess.reason === "started_late" ||
                assess.reason === "skipped_speech" ||
                assess.reason === "junk_output"))
          ) {
            retryLanguage = "hi";
          } else if (
            (isHinglish || targetLanguage === "auto") &&
            activeWindowLanguage === "hi" &&
            (assess.reason === "repetition_loop" || assess.reason === "single_token_dominance" || assess.reason === "junk_output")
          ) {
            retryLanguage = "en";
          }

          if (recoveryStrategy === "legacy_bisect") {
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
                let half1Lang = retryLanguage;
                let half2Lang = retryLanguage;
                if (isHinglish) {
                  if (calculateRms(half1Audio) >= 0.01) {
                    try {
                      const d1 = await detectLanguage(speechPipeline, half1Audio, {
                        candidates: ["en", "hi", "ur"],
                        coerceHindustani: true,
                      });
                      half1Lang = d1 === "en" ? "en" : "hi";
                    } catch {
                      half1Lang = retryLanguage;
                    }
                  }
                  if (calculateRms(half2Audio) >= 0.01) {
                    try {
                      const d2 = await detectLanguage(speechPipeline, half2Audio, {
                        candidates: ["en", "hi", "ur"],
                        coerceHindustani: true,
                      });
                      half2Lang = d2 === "en" ? "en" : "hi";
                    } catch {
                      half2Lang = retryLanguage;
                    }
                  }
                }

                const retryOpts1: Record<string, unknown> = {
                  return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                  language: half1Lang,
                  task: "transcribe",
                  max_new_tokens: maxNewTokensFor(half1Audio.length / 16000),
                };
                const retryOpts2: Record<string, unknown> = {
                  return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                  language: half2Lang,
                  task: "transcribe",
                  max_new_tokens: maxNewTokensFor(half2Audio.length / 16000),
                };

                const out1 = await speechPipeline(half1Audio, retryOpts1);
                const out2 = await speechPipeline(half2Audio, retryOpts2);

                const half1Res = parseWindowOutput(out1, { index: 0, start: 0, end: half1EndRel }, isHinglish ? "hinglish" : half1Lang);
                const half2Res = parseWindowOutput(out2, { index: 1, start: half2StartRel, end: winDur }, isHinglish ? "hinglish" : half2Lang);
                const retryMerged = mergeWindowTranscripts([half1Res, half2Res], winDur);

                const retryTokens = retryMerged.words.map((w) => normalizeToken(w.text)).filter(Boolean);
                const retryHasLoop = hasRepetitionLoop(retryTokens);

                let accepted = false;
                let acceptanceReason = "rejected: worse or invalid";
                if (!retryHasLoop) {
                  if (assess.reason === "repetition_loop") {
                    accepted = true;
                    acceptanceReason = "accepted: broke repetition loop";
                  } else if (assess.reason === "foreign_script") {
                    const origForeign = countForeignScriptWords(windowResult.words, (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage);
                    const retryForeign = countForeignScriptWords(retryMerged.words, (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage);
                    accepted = retryForeign < origForeign;
                    acceptanceReason = accepted
                      ? `accepted: reduced foreign script words from ${origForeign} to ${retryForeign}`
                      : `rejected: foreign script words did not decrease (${retryForeign} vs ${origForeign})`;
                  } else if (assess.reason === "junk_output") {
                    const origJunk = countJunkWords(windowResult.words);
                    const retryJunk = countJunkWords(retryMerged.words);
                    accepted = retryJunk < origJunk;
                    acceptanceReason = accepted
                      ? `accepted: reduced junk words from ${origJunk} to ${retryJunk}`
                      : `rejected: junk words did not decrease (${retryJunk} vs ${origJunk})`;
                  } else if (assess.flaggedRegion) {
                    const origCount = countWordsInRegion(windowResult.words, assess.flaggedRegion);
                    const retryCount = countWordsInRegion(retryMerged.words, assess.flaggedRegion);
                    accepted = retryCount > origCount;
                    acceptanceReason = accepted
                      ? `accepted: words in flagged region increased from ${origCount} to ${retryCount}`
                      : `rejected: words in flagged region did not increase (${retryCount} <= ${origCount})`;
                  } else {
                    accepted = retryMerged.words.length > windowResult.words.length;
                    acceptanceReason = accepted
                      ? `accepted: total words increased from ${windowResult.words.length} to ${retryMerged.words.length}`
                      : `rejected: total words did not increase (${retryMerged.words.length} <= ${windowResult.words.length})`;
                  }
                } else {
                  acceptanceReason = "rejected: retry contained repetition loop";
                }

                if (winDiag) {
                  const normOut1 = (Array.isArray(out1) ? out1[0] : out1) as SpeechPipelineOutput | undefined;
                  const normOut2 = (Array.isArray(out2) ? out2[0] : out2) as SpeechPipelineOutput | undefined;
                  winDiag.retryExecution = {
                    attempted: true,
                    strategy: "legacy_bisect",
                    half1: {
                      duration: half1EndRel,
                      language: half1Lang,
                      rawText: typeof normOut1?.text === "string" ? normOut1.text : "",
                      wordCount: half1Res.words.length,
                      words: half1Res.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
                    },
                    half2: {
                      duration: winDur - half2StartRel,
                      language: half2Lang,
                      rawText: typeof normOut2?.text === "string" ? normOut2.text : "",
                      wordCount: half2Res.words.length,
                      words: half2Res.words.map((w) => ({ text: w.text, start: w.start, end: w.end })),
                    },
                    mergedWordCount: retryMerged.words.length,
                    accepted,
                    acceptanceReason,
                  };
                }

                if (accepted) {
                  windowResult = {
                    window,
                    granularity: retryMerged.granularity,
                    language: retryLanguage,
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
          } else {
            // Default "ladder": Multi-candidate recovery with structural validation
            interface LadderCandidate {
              id: string;
              description: string;
              transcript: WindowTranscript;
              validation: CandidateValidationResult;
            }
            const ladderCandidates: LadderCandidate[] = [];

            // Candidate 1: Targeted alternative decoding on full window with repetition penalty
            const cand1RepPenalty = Math.max(1.15, (options.repetitionPenalty ?? 1.0) * 1.05);
            const cand1Ngram = options.noRepeatNgramSize ?? 3;
            const cand1Opts: Record<string, unknown> = {
              return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
              language: retryLanguage,
              task: "transcribe",
              max_new_tokens: maxNewTokensFor(audio.length / 16000),
              repetition_penalty: cand1RepPenalty,
              no_repeat_ngram_size: cand1Ngram,
            };
            if (initialPrompt) cand1Opts.initial_prompt = initialPrompt;

            try {
              const cand1Out = await speechPipeline(audio, cand1Opts);
              const cand1Res = parseWindowOutput(cand1Out, window, isHinglish ? "hinglish" : retryLanguage);
              const cand1Val = validateCandidateTranscript(
                cand1Res,
                (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage,
                assess.speechSeconds,
              );
              ladderCandidates.push({
                id: "cand1_full_rep_penalty",
                description: `Full window (rep_penalty=${cand1RepPenalty.toFixed(2)}, ngram=${cand1Ngram})`,
                transcript: cand1Res,
                validation: cand1Val,
              });
            } catch (c1Err) {
              console.warn("Candidate 1 generation failed:", c1Err);
            }

            // If Candidate 1 failed structural validation (e.g. loops, foreign script, high junk, or empty)
            // or if Candidate 1 produced 0 words, evaluate Candidate 2 (Bisection with mild repetition penalty)
            const c1Valid = ladderCandidates[0]?.validation.valid;
            if (!c1Valid && winDur >= 1.0) {
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
                const midRel = winDur / 2;
                half1EndRel = Math.min(winDur, winDur > 2 ? midRel + 0.5 : midRel);
                half2StartRel = Math.max(0, winDur > 2 ? midRel - 0.5 : midRel);
              }

              const half1Samples = Math.round(half1EndRel * 16000);
              const half2StartSample = Math.round(half2StartRel * 16000);
              const half1Audio = audio.subarray(0, half1Samples).slice();
              const half2Audio = audio.subarray(half2StartSample).slice();

              if (half1Audio.length > 0 && half2Audio.length > 0) {
                let half1Lang = retryLanguage;
                let half2Lang = retryLanguage;
                if (isHinglish) {
                  if (calculateRms(half1Audio) >= 0.01) {
                    try {
                      const d1 = await detectLanguage(speechPipeline, half1Audio, {
                        candidates: ["en", "hi", "ur"],
                        coerceHindustani: true,
                      });
                      half1Lang = d1 === "en" ? "en" : "hi";
                    } catch {
                      half1Lang = retryLanguage;
                    }
                  }
                  if (calculateRms(half2Audio) >= 0.01) {
                    try {
                      const d2 = await detectLanguage(speechPipeline, half2Audio, {
                        candidates: ["en", "hi", "ur"],
                        coerceHindustani: true,
                      });
                      half2Lang = d2 === "en" ? "en" : "hi";
                    } catch {
                      half2Lang = retryLanguage;
                    }
                  }
                }

                const retryOpts1: Record<string, unknown> = {
                  return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                  language: half1Lang,
                  task: "transcribe",
                  max_new_tokens: maxNewTokensFor(half1Audio.length / 16000),
                  repetition_penalty: 1.10,
                  no_repeat_ngram_size: 3,
                };
                const retryOpts2: Record<string, unknown> = {
                  return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                  language: half2Lang,
                  task: "transcribe",
                  max_new_tokens: maxNewTokensFor(half2Audio.length / 16000),
                  repetition_penalty: 1.10,
                  no_repeat_ngram_size: 3,
                };

                try {
                  const out1 = await speechPipeline(half1Audio, retryOpts1);
                  const out2 = await speechPipeline(half2Audio, retryOpts2);

                  const half1Res = parseWindowOutput(out1, { index: 0, start: 0, end: half1EndRel }, isHinglish ? "hinglish" : half1Lang);
                  const half2Res = parseWindowOutput(out2, { index: 1, start: half2StartRel, end: winDur }, isHinglish ? "hinglish" : half2Lang);
                  const mergedRes = mergeWindowTranscripts([half1Res, half2Res], winDur);
                  const cand2Merged: WindowTranscript = {
                    window,
                    granularity: mergedRes.granularity,
                    language: retryLanguage,
                    segments: mergedRes.segments,
                    words: mergedRes.words,
                  };
                  const cand2Val = validateCandidateTranscript(
                    cand2Merged,
                    (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage,
                    assess.speechSeconds,
                  );
                  ladderCandidates.push({
                    id: "cand2_bisect_rep",
                    description: "Bisected halves with rep_penalty=1.10, ngram=3",
                    transcript: cand2Merged,
                    validation: cand2Val,
                  });
                } catch (c2Err) {
                  console.warn("Candidate 2 generation failed:", c2Err);
                }
              }
            }

            // If both Candidate 1 and Candidate 2 failed, evaluate Candidate 3 (Temperature sampling fallback)
            const anyValidSoFar = ladderCandidates.some((c) => c.validation.valid);
            if (!anyValidSoFar) {
              const cand3Opts: Record<string, unknown> = {
                return_timestamps: MODEL_CONFIG[runtime.model].supportsWordTimestamps ? "word" : true,
                language: retryLanguage,
                task: "transcribe",
                max_new_tokens: maxNewTokensFor(audio.length / 16000),
                do_sample: true,
                temperature: 0.3,
                repetition_penalty: 1.15,
                no_repeat_ngram_size: 3,
              };
              if (initialPrompt) cand3Opts.initial_prompt = initialPrompt;

              try {
                const cand3Out = await speechPipeline(audio, cand3Opts);
                const cand3Res = parseWindowOutput(cand3Out, window, isHinglish ? "hinglish" : retryLanguage);
                const cand3Val = validateCandidateTranscript(
                  cand3Res,
                  (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage,
                  assess.speechSeconds,
                );
                ladderCandidates.push({
                  id: "cand3_sampling",
                  description: "Sampling with temperature=0.3, rep_penalty=1.15",
                  transcript: cand3Res,
                  validation: cand3Val,
                });
              } catch (c3Err) {
                console.warn("Candidate 3 generation failed:", c3Err);
              }
            }

            // Candidate Selection & Acceptance
            const validCandidates = ladderCandidates.filter((c) => c.validation.valid);
            let accepted = false;
            let acceptanceReason = "rejected: all candidates failed structural validation";
            let selectedCandidate: LadderCandidate | undefined;

            if (validCandidates.length > 0) {
              // Priority: Candidate 1 (clean full window, no bisection seam) > Candidate 2 > Candidate 3
              // Choose the candidate with lowest junk words, then highest valid words
              validCandidates.sort((a, b) => {
                if (a.validation.junkCount !== b.validation.junkCount) {
                  return a.validation.junkCount - b.validation.junkCount;
                }
                // If candidate 1 is valid with 0 junk, strongly prefer full window
                if (a.id === "cand1_full_rep_penalty") return -1;
                if (b.id === "cand1_full_rep_penalty") return 1;
                return b.validation.tokenCount - a.validation.tokenCount;
              });

              const bestCandidate = validCandidates[0];
              const candTokens = bestCandidate.validation.tokenCount;
              const origTokens = windowResult.words.length;

              if (assess.reason === "repetition_loop" || assess.reason === "single_token_dominance") {
                accepted = true;
                acceptanceReason = `accepted ${bestCandidate.id}: broke repetition loop (${bestCandidate.description})`;
              } else if (assess.reason === "foreign_script") {
                const origForeign = countForeignScriptWords(windowResult.words, (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage);
                const candForeign = bestCandidate.validation.foreignCount;
                accepted = candForeign < origForeign;
                acceptanceReason = accepted
                  ? `accepted ${bestCandidate.id}: reduced foreign script words from ${origForeign} to ${candForeign}`
                  : `rejected: foreign script words did not decrease (${candForeign} vs ${origForeign})`;
              } else if (assess.reason === "junk_output") {
                const origJunk = countJunkWords(windowResult.words, (isHinglish ? "hinglish" : retryLanguage) as CaptionLanguage);
                const candJunk = bestCandidate.validation.junkCount;
                accepted = candJunk < origJunk;
                acceptanceReason = accepted
                  ? `accepted ${bestCandidate.id}: reduced junk words from ${origJunk} to ${candJunk}`
                  : `rejected: junk words did not decrease (${candJunk} vs ${origJunk})`;
              } else if (assess.flaggedRegion) {
                const origCount = countWordsInRegion(windowResult.words, assess.flaggedRegion);
                const candCount = countWordsInRegion(bestCandidate.transcript.words, assess.flaggedRegion);
                // Candidate must improve words in flagged region AND must not suffer severe overall truncation
                accepted = candCount > origCount && candTokens >= Math.floor(origTokens * 0.8);
                acceptanceReason = accepted
                  ? `accepted ${bestCandidate.id}: words in flagged region increased from ${origCount} to ${candCount}`
                  : `rejected: candidate did not improve flagged region (${candCount} <= ${origCount}) or suffered truncation (${candTokens} vs ${origTokens})`;
              } else {
                accepted = candTokens > origTokens;
                acceptanceReason = accepted
                  ? `accepted ${bestCandidate.id}: total words increased from ${origTokens} to ${candTokens}`
                  : `rejected: total words did not increase (${candTokens} <= ${origTokens})`;
              }

              if (accepted) {
                selectedCandidate = bestCandidate;
              }
            } else {
              acceptanceReason = `rejected: all recovery candidates failed structural validation (${ladderCandidates.map((c) => `${c.id}: ${c.validation.reason}`).join("; ")})`;
            }

            if (winDiag) {
              winDiag.retryExecution = {
                attempted: true,
                strategy: "ladder",
                ladderCandidates: ladderCandidates.map((c) => ({
                  id: c.id,
                  valid: c.validation.valid,
                  reason: c.validation.reason,
                  wordCount: c.validation.tokenCount,
                  junkCount: c.validation.junkCount,
                  foreignCount: c.validation.foreignCount,
                })),
                selectedCandidate: selectedCandidate?.id,
                mergedWordCount: selectedCandidate ? selectedCandidate.transcript.words.length : 0,
                accepted,
                acceptanceReason,
              };
            }

            if (accepted && selectedCandidate) {
              windowResult = {
                window,
                granularity: selectedCandidate.transcript.granularity,
                language: retryLanguage,
                segments: selectedCandidate.transcript.segments.map((s) => ({
                  text: s.text,
                  start: s.start,
                  end: s.end,
                  words: s.words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(w.kind ? { kind: w.kind } : {}) })),
                })),
                words: selectedCandidate.transcript.words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(w.kind ? { kind: w.kind } : {}) })),
              };
              retriedWindows++;
            } else if (assess.reason === "repetition_loop" || assess.reason === "single_token_dominance") {
              // When all candidates fail or retry was rejected, sanitize the original to strip loops
              const sanitizedWords = removeRepetitionLoops(removeJunkWords(windowResult.words, (isHinglish ? "hinglish" : activeWindowLanguage) as CaptionLanguage));
              windowResult.words = sanitizedWords;
              windowResult.segments = groupWordsIntoSegments(sanitizedWords);
            }
          }
          transcribeMs += performance.now() - retryStartedAt;
        }
      }

      lastTranscribeSeconds = Math.max(lastTranscribeSeconds, window.end);
      emitProgress({ stage: "transcribe", seconds: lastTranscribeSeconds, duration });

      windowResults.push(
        sanitizeWindowResult(
          windowResult,
          (isHinglish ? "hinglish" : activeWindowLanguage) as CaptionLanguage,
          winDiag
            ? (postDiag) => {
                winDiag.postProcessing = postDiag;
              }
            : undefined,
        ),
      );

      if (diagnostics && winDiag) {
        diagnostics.windows.push(winDiag);
      }
    }
  } finally {
    clearInterval(heartbeat);
    provider.dispose();
  }

  const mergeDiag: { info?: MergeDiagnosticInfo } = {};
  const merged = mergeWindowTranscripts(windowResults, duration, diagnostics ? mergeDiag : undefined);

  if (diagnostics && mergeDiag.info) {
    diagnostics.merging = {
      windowCount: windowResults.length,
      inputTotalWords: windowResults.reduce((acc, w) => acc + w.words.length, 0),
      cutPoints: mergeDiag.info.cutPoints,
      totalAcceptedWords: mergeDiag.info.totalAcceptedWords,
      finalNormalizedWords: mergeDiag.info.finalNormalizedWords,
    };

    const rawWordsTotal = diagnostics.windows.reduce((acc, w) => {
      const chunkWordCount = w.rawOutput.chunks.flatMap((c) => c.text.trim().split(/\s+/)).filter(Boolean).length;
      const textWordCount = w.rawOutput.text.trim().split(/\s+/).filter(Boolean).length;
      return acc + (chunkWordCount > 0 ? chunkWordCount : textWordCount);
    }, 0);
    const parsedWordsTotal = diagnostics.windows.reduce((acc, w) => acc + w.parsedInitial.wordCount, 0);
    const retryOutcomeWordsTotal = diagnostics.windows.reduce((acc, w) => {
      if (w.retryExecution?.attempted) {
        return acc + (w.retryExecution.accepted ? w.retryExecution.mergedWordCount : w.parsedInitial.wordCount);
      }
      return acc + w.parsedInitial.wordCount;
    }, 0);
    const scriptFilterWordsTotal = diagnostics.windows.reduce(
      (acc, w) => acc + w.postProcessing.afterForeignScriptFilter.count,
      0,
    );
    const junkFilterWordsTotal = diagnostics.windows.reduce(
      (acc, w) => acc + w.postProcessing.afterJunkFilter.count,
      0,
    );
    const repFilterWordsTotal = diagnostics.windows.reduce(
      (acc, w) => acc + w.postProcessing.afterRepetitionFilter.count,
      0,
    );
    const mergeWordsTotal = diagnostics.merging.totalAcceptedWords;
    const finalWordsTotal = merged.words.length;

    const baseDenom = rawWordsTotal > 0 ? rawWordsTotal : 1;
    diagnostics.attritionSummary = [
      {
        stage: "raw_whisper_output",
        inputWords: rawWordsTotal,
        outputWords: rawWordsTotal,
        removedWords: 0,
        retentionRate: rawWordsTotal > 0 ? 1.0 : 0.0,
        notes: "Direct output from Transformers.js pipeline before parsing",
      },
      {
        stage: "output_parsing",
        inputWords: rawWordsTotal,
        outputWords: parsedWordsTotal,
        removedWords: Math.max(0, rawWordsTotal - parsedWordsTotal),
        retentionRate: rawWordsTotal > 0 ? parsedWordsTotal / baseDenom : 0.0,
        notes: "Chunk extraction, artefact stripping, transliteration",
      },
      {
        stage: "retry_evaluation_outcome",
        inputWords: parsedWordsTotal,
        outputWords: retryOutcomeWordsTotal,
        removedWords: Math.max(0, parsedWordsTotal - retryOutcomeWordsTotal),
        retentionRate: rawWordsTotal > 0 ? retryOutcomeWordsTotal / baseDenom : 0.0,
        notes: "Bisected retry execution and acceptance logic",
      },
      {
        stage: "foreign_script_filter",
        inputWords: retryOutcomeWordsTotal,
        outputWords: scriptFilterWordsTotal,
        removedWords: Math.max(0, retryOutcomeWordsTotal - scriptFilterWordsTotal),
        retentionRate: rawWordsTotal > 0 ? scriptFilterWordsTotal / baseDenom : 0.0,
        notes: "Enforcement of permissible scripts per language mode",
      },
      {
        stage: "junk_filter",
        inputWords: scriptFilterWordsTotal,
        outputWords: junkFilterWordsTotal,
        removedWords: Math.max(0, scriptFilterWordsTotal - junkFilterWordsTotal),
        retentionRate: rawWordsTotal > 0 ? junkFilterWordsTotal / baseDenom : 0.0,
        notes: "Removal of non-alphanumeric and anomalous tokens",
      },
      {
        stage: "repetition_filter",
        inputWords: junkFilterWordsTotal,
        outputWords: repFilterWordsTotal,
        removedWords: Math.max(0, junkFilterWordsTotal - repFilterWordsTotal),
        retentionRate: rawWordsTotal > 0 ? repFilterWordsTotal / baseDenom : 0.0,
        notes: "Suppression of consecutive repeated phrases",
      },
      {
        stage: "window_merging",
        inputWords: repFilterWordsTotal,
        outputWords: mergeWordsTotal,
        removedWords: Math.max(0, repFilterWordsTotal - mergeWordsTotal),
        retentionRate: rawWordsTotal > 0 ? mergeWordsTotal / baseDenom : 0.0,
        notes: "Cut-point boundary selection across overlapping windows",
      },
      {
        stage: "final_transcript",
        inputWords: mergeWordsTotal,
        outputWords: finalWordsTotal,
        removedWords: Math.max(0, mergeWordsTotal - finalWordsTotal),
        retentionRate: rawWordsTotal > 0 ? finalWordsTotal / baseDenom : 0.0,
        notes: "Final timestamp normalization and segment assembly",
      },
    ];
  }

  const processingWallMs = performance.now() - processingStartedAt;

  // realTimeFactor: media seconds processed per wall-clock second of processing (excluding model load).
  const realTimeFactor = processingWallMs > 0 ? duration / (processingWallMs / 1000) : 0;

  return {
    language: isHinglish ? "hinglish" : lockedLanguage,
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
    diagnostics,
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
  const raw = chunks
    .map((chunk): RawTimedText => ({
      text: (chunk.text ?? "").replace(/\uFFFD/g, ""),
      start: chunk.timestamp?.[0] ?? null,
      end: chunk.timestamp?.[1] ?? null,
    }))
    .filter((item) => item.text.trim().length > 0);

  const hasUsableTimestamps = raw.some(
    (item) => typeof item.start === "number" && typeof item.end === "number",
  );
  if (!hasUsableTimestamps) {
    const rawText = (typeof result.text === "string" ? result.text : "").replace(/\uFFFD/g, "").trim();
    if (!rawText) {
      return {
        window,
        granularity: "word",
        language,
        segments: [],
        words: [],
      };
    }
    const text = requestedLanguage === "hinglish" ? transliterateDevanagariToHinglish(rawText) : rawText;
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
  if (requestedLanguage === "hinglish") {
    for (const w of words) {
      w.text = transliterateDevanagariToHinglish(w.text);
    }
  }
  const segments = groupWordsIntoSegments(words);
  if (requestedLanguage === "hinglish") {
    for (const s of segments) {
      s.text = transliterateDevanagariToHinglish(s.text);
      for (const w of s.words) {
        w.text = transliterateDevanagariToHinglish(w.text);
      }
    }
  }
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
