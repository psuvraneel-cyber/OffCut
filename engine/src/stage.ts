import type { Stage, StageContext } from "../../runtime/src/types.js";
import { createTranscriber } from "./index.js";
import type {
  Device,
  Progress,
  Transcriber,
  TranscriberOptions,
  Transcript,
} from "./types.js";

export interface NormalizedProgress {
  fraction: number;
  detail: string;
}

export function mapTranscriptionProgress(progress: Progress): NormalizedProgress {
  switch (progress.stage) {
    case "download": {
      const frac = progress.total > 0 ? (progress.loaded / progress.total) * 0.1 : 0;
      const loadedMb = (progress.loaded / (1024 * 1024)).toFixed(1);
      const totalMb = (progress.total / (1024 * 1024)).toFixed(1);
      return {
        fraction: Math.min(0.1, Math.max(0, frac)),
        detail: `Downloading speech model (${loadedMb}/${totalMb} MB)...`,
      };
    }
    case "load": {
      return {
        fraction: 0.1,
        detail: "Loading speech model into memory...",
      };
    }
    case "decode": {
      const decodeFrac = progress.duration > 0 ? (progress.seconds / progress.duration) * 0.15 : 0;
      const sec = Math.round(progress.seconds);
      const dur = Math.round(progress.duration);
      return {
        fraction: Math.min(0.25, Math.max(0.1, 0.1 + decodeFrac)),
        detail: `Reading audio: ${sec}s / ${dur}s`,
      };
    }
    case "transcribe": {
      const transcribeFrac = progress.duration > 0 ? (progress.seconds / progress.duration) * 0.75 : 0;
      const sec = Math.round(progress.seconds);
      const dur = Math.round(progress.duration);
      return {
        fraction: Math.min(1.0, Math.max(0.25, 0.25 + transcribeFrac)),
        detail: `Transcribing: ${sec}s / ${dur}s`,
      };
    }
  }
}

export interface TranscriptionStageOptions extends Omit<TranscriberOptions, "device"> {
  device?: Device;
  language?: string;
  initialPrompt?: string;
  vad?: boolean;
  weight?: number;
  transcriberFactory?: (options: TranscriberOptions) => Transcriber;
}

export function createTranscriptionStage(
  options: TranscriptionStageOptions = {},
): Stage<Blob, Transcript> {
  const {
    language = "auto",
    initialPrompt,
    vad,
    weight = 1,
    transcriberFactory = createTranscriber,
    ...transcriberOptions
  } = options;

  let currentTranscriber: Transcriber | null = null;

  return {
    name: "transcribe",
    resource: "gpu",
    weight,
    supportsWasmFallback: true,

    async run(file: Blob, context: StageContext): Promise<Transcript> {
      const resolvedDevice: Device = options.device && options.device !== "auto"
        ? options.device
        : (context.device === "webgpu" ? "webgpu" : "wasm");

      const transcriber = transcriberFactory({
        ...transcriberOptions,
        device: resolvedDevice,
      });
      currentTranscriber = transcriber;

      return transcriber.transcribe(file, {
        language,
        initialPrompt,
        vad,
        signal: context.signal,
        onProgress: (p: Progress) => {
          const { fraction, detail } = mapTranscriptionProgress(p);
          context.reportProgress(fraction, detail);
        },
      });
    },

    async release(): Promise<void> {
      if (currentTranscriber) {
        const transcriber = currentTranscriber;
        currentTranscriber = null;
        await transcriber.dispose();
      }
    },

    terminate(): void {
      if (currentTranscriber) {
        const transcriber = currentTranscriber;
        currentTranscriber = null;
        void transcriber.dispose();
      }
    },
  };
}
