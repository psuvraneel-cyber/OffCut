import { describe, expect, it, vi } from "vitest";
import {
  createTranscriptionStage,
  mapTranscriptionProgress,
} from "../src/index.js";
import type {
  Progress,
  Transcriber,
  TranscriberOptions,
  TranscribeOptions,
  Transcript,
} from "../src/types.js";
import { createRuntime, RuntimeAbortError } from "../../runtime/src/index.js";
import type { StageContext } from "../../runtime/src/types.js";

function createMockTranscript(device: "webgpu" | "wasm" = "webgpu"): Transcript {
  return {
    language: "en",
    duration: 10,
    granularity: "word",
    segments: [],
    words: [{ text: "Hello", start: 0, end: 1 }],
    stats: {
      model: "base",
      device,
      dtype: "fp32",
      loadMs: 50,
      decodeMs: 20,
      transcribeMs: 100,
      realTimeFactor: 0.1,
    },
  };
}

describe("Transcription Stage", () => {
  describe("mapTranscriptionProgress", () => {
    it("maps download progress to 0..0.1 range with MB details", () => {
      const p: Progress = {
        stage: "download",
        file: "model.onnx",
        loaded: 50 * 1024 * 1024,
        total: 100 * 1024 * 1024,
      };
      const result = mapTranscriptionProgress(p);
      expect(result.fraction).toBeCloseTo(0.05);
      expect(result.detail).toContain("50.0/100.0 MB");
    });

    it("maps load progress to 0.1", () => {
      const result = mapTranscriptionProgress({ stage: "load" });
      expect(result.fraction).toBe(0.1);
      expect(result.detail).toBe("Loading speech model into memory...");
    });

    it("maps decode progress to 0.1..0.25 range with duration details", () => {
      const p: Progress = { stage: "decode", seconds: 5, duration: 10 };
      const result = mapTranscriptionProgress(p);
      expect(result.fraction).toBeCloseTo(0.175);
      expect(result.detail).toBe("Reading audio: 5s / 10s");
    });

    it("maps transcribe progress to 0.25..1.0 range with duration details", () => {
      const p: Progress = { stage: "transcribe", seconds: 5, duration: 10 };
      const result = mapTranscriptionProgress(p);
      expect(result.fraction).toBeCloseTo(0.625);
      expect(result.detail).toBe("Transcribing: 5s / 10s");
    });
  });

  describe("stage metadata & options", () => {
    it("has correct stage contract properties", () => {
      const stage = createTranscriptionStage({ weight: 3 });
      expect(stage.name).toBe("transcribe");
      expect(stage.resource).toBe("gpu");
      expect(stage.weight).toBe(3);
      expect(stage.supportsWasmFallback).toBe(true);
    });

    it("defaults weight to 1", () => {
      const stage = createTranscriptionStage();
      expect(stage.weight).toBe(1);
    });
  });

  describe("lifecycle and run", () => {
    it("creates transcriber with context device and forwards progress and signal", async () => {
      let createdOptions: TranscriberOptions | undefined;
      let transcribeCallCount = 0;
      const reportedProgress: Array<{ fraction: number; detail?: string }> = [];

      let forwardedOptions: TranscribeOptions | undefined;

      const mockTranscriber: Transcriber = {
        load: async () => undefined,
        transcribe: async (_file: Blob, opts?: TranscribeOptions) => {
          transcribeCallCount += 1;
          forwardedOptions = opts;
          opts?.onProgress?.({ stage: "decode", seconds: 2, duration: 4 });
          opts?.onProgress?.({ stage: "transcribe", seconds: 4, duration: 4 });
          return createMockTranscript("webgpu");
        },
        dispose: vi.fn(),
      };

      const stage = createTranscriptionStage({
        model: "base",
        language: "en",
        initialPrompt: "Test prompt",
        vad: true,
        transcriberFactory: (opts) => {
          createdOptions = opts;
          return mockTranscriber;
        },
      });

      const abortController = new AbortController();
      const context: StageContext = {
        signal: abortController.signal,
        device: "webgpu",
        reportProgress: (fraction, detail) => {
          reportedProgress.push({ fraction, detail });
        },
      };

      const dummyBlob = new Blob(["fake audio"], { type: "audio/wav" });
      const transcript = await stage.run(dummyBlob, context);

      expect(createdOptions).toEqual({
        model: "base",
        device: "webgpu",
      });
      expect(transcribeCallCount).toBe(1);
      expect(forwardedOptions?.initialPrompt).toBe("Test prompt");
      expect(transcript.words[0]?.text).toBe("Hello");
      expect(reportedProgress).toHaveLength(2);
      expect(reportedProgress[0].fraction).toBeCloseTo(0.175);
      expect(reportedProgress[1].fraction).toBe(1.0);

      // Verify release disposes the transcriber
      await stage.release();
      expect(mockTranscriber.dispose).toHaveBeenCalledTimes(1);
    });

    it("terminate calls dispose on current transcriber", async () => {
      const mockTranscriber: Transcriber = {
        load: async () => undefined,
        transcribe: async () => createMockTranscript(),
        dispose: vi.fn(),
      };

      const stage = createTranscriptionStage({
        transcriberFactory: () => mockTranscriber,
      });

      const context: StageContext = {
        signal: new AbortController().signal,
        device: "wasm",
        reportProgress: () => undefined,
      };

      await stage.run(new Blob([]), context);
      stage.terminate?.();
      expect(mockTranscriber.dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe("integration with offcut-runtime", () => {
    it("successfully runs inside a runtime job with GPU lock", async () => {
      const mockTranscriber: Transcriber = {
        load: async () => undefined,
        transcribe: async () => createMockTranscript("webgpu"),
        dispose: vi.fn(),
      };

      const stage = createTranscriptionStage({
        transcriberFactory: () => mockTranscriber,
      });

      const runtime = createRuntime({ gpuAvailable: true });
      const progressFractions: number[] = [];

      const result = await runtime.runJob<Transcript>(
        [stage],
        new Blob(["test audio"]),
        {
          onProgress: (p) => progressFractions.push(p.fraction),
        },
      );

      expect(result.words[0].text).toBe("Hello");
      expect(mockTranscriber.dispose).toHaveBeenCalledTimes(1);
      expect(runtime.health()).toEqual({ webgpu: "ok" });
      expect(progressFractions.at(-1)).toBe(1);
    });

    it("recovers from GpuLostError by retrying on wasm through runtime", async () => {
      let attempts = 0;
      const devicesUsed: string[] = [];

      const stage = createTranscriptionStage({
        transcriberFactory: (opts) => {
          devicesUsed.push(opts.device ?? "auto");
          return {
            load: async () => undefined,
            transcribe: async () => {
              attempts += 1;
              if (attempts === 1) {
                const gpuLost = new Error("WebGPU device was lost");
                gpuLost.name = "GpuLostError";
                throw gpuLost;
              }
              return createMockTranscript("wasm");
            },
            dispose: vi.fn(),
          };
        },
      });

      const events: string[] = [];
      const runtime = createRuntime({
        gpuAvailable: true,
        onEvent: (e) => events.push(e.type),
      });

      const result = await runtime.runJob<Transcript>([stage], new Blob([]));

      expect(attempts).toBe(2);
      expect(devicesUsed).toEqual(["webgpu", "wasm"]);
      expect(result.stats.device).toBe("wasm");
      expect(runtime.health()).toEqual({ webgpu: "unhealthy" });
      expect(events).toContain("gpu-lost");
    });

    it("aborts job cleanly when signal is aborted mid-transcription", async () => {
      const abortController = new AbortController();
      let disposeCalled = false;

      const mockTranscriber: Transcriber = {
        load: async () => undefined,
        transcribe: async (_file, opts) => {
          return new Promise<Transcript>((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted.");
              err.name = "AbortError";
              reject(err);
            });
          });
        },
        dispose: () => {
          disposeCalled = true;
        },
      };

      const stage = createTranscriptionStage({
        transcriberFactory: () => mockTranscriber,
      });

      const runtime = createRuntime({ gpuAvailable: true, cancelGraceMs: 50 });
      const job = runtime.runJob([stage], new Blob([]), {
        signal: abortController.signal,
      });

      await Promise.resolve();
      abortController.abort();

      await expect(job).rejects.toBeInstanceOf(RuntimeAbortError);
      expect(disposeCalled).toBe(true);
    });
  });
});
