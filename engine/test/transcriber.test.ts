import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTranscriber } from "../src/index";
import { AbortError } from "../src/errors";

class MockWorker {
  static instances: MockWorker[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  terminated = false;
  postedMessages: unknown[] = [];

  constructor() {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners["message"] ?? []) {
      listener({ data });
    }
  }

  emitError(message: string): void {
    for (const listener of this.listeners["error"] ?? []) {
      listener({ message });
    }
  }
}

describe("BrowserTranscriber lifecycle & cancellation (5a)", () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    MockWorker.instances = [];
    globalThis.Worker = MockWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  it("makes dispose() safe to call twice without error", () => {
    const transcriber = createTranscriber({ model: "tiny", device: "wasm" });
    expect(() => transcriber.dispose()).not.toThrow();
    expect(() => transcriber.dispose()).not.toThrow();
    expect(MockWorker.instances[0].terminated).toBe(true);
  });

  it("rejects load() and transcribe() after dispose() with clear error", async () => {
    const transcriber = createTranscriber({ model: "tiny", device: "wasm" });
    transcriber.dispose();

    await expect(transcriber.load()).rejects.toThrow("Transcriber has been disposed.");
    await expect(transcriber.transcribe(new Blob())).rejects.toThrow("Transcriber has been disposed.");
  });

  it("rejects other pending requests with AbortError when a request is aborted", async () => {
    const transcriber = createTranscriber({ model: "tiny", device: "wasm" });
    const controller = new AbortController();

    // Start load request (requestId 1)
    const loadPromise = transcriber.load();
    await new Promise((r) => setTimeout(r, 10));

    // Start transcribe request with signal (requestId 2)
    const transcribePromise = transcriber.transcribe(new Blob(["audio"]), { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));

    // Abort transcribe request
    controller.abort();

    // Both requests must reject with AbortError, and neither should be orphaned
    await expect(transcribePromise).rejects.toBeInstanceOf(AbortError);
    await expect(loadPromise).rejects.toBeInstanceOf(AbortError);

    // Old worker was terminated
    expect(MockWorker.instances[0].terminated).toBe(true);
    // A new worker was created and is ready
    expect(MockWorker.instances.length).toBe(2);
    expect(MockWorker.instances[1].terminated).toBe(false);
  });

  it("handles needs-fallback-decode by downmixing and sending transcribe-pcm", async () => {
    const transcriber = createTranscriber({ model: "tiny", device: "wasm" });
    const originalOfflineCtx = (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;

    class MockOfflineAudioContext {
      decodeAudioData = async () => {
        const left = new Float32Array([0.2, 0.4, 0.6]);
        const right = new Float32Array([0.4, 0.6, 0.8]);
        return {
          numberOfChannels: 2,
          length: 3,
          duration: 3 / 16000,
          sampleRate: 16000,
          getChannelData: (ch: number) => (ch === 0 ? left : right),
        };
      };
    }

    (globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = MockOfflineAudioContext;

    try {
      const transcribePromise = transcriber.transcribe(new Blob(["test-audio"]));
      await new Promise((r) => setTimeout(r, 10));

      const worker = MockWorker.instances[0];
      expect(worker.postedMessages).toHaveLength(1);
      const req = worker.postedMessages[0] as { type: string; requestId: number };
      expect(req.type).toBe("transcribe");

      // Worker requests fallback decode
      worker.emitMessage({ type: "needs-fallback-decode", requestId: req.requestId });
      await new Promise((r) => setTimeout(r, 20));

      // Main thread should post transcribe-pcm
      expect(worker.postedMessages).toHaveLength(2);
      const pcmMsg = worker.postedMessages[1] as {
        type: string;
        requestId: number;
        pcm: Float32Array;
        sampleRate: number;
      };
      expect(pcmMsg.type).toBe("transcribe-pcm");
      expect(pcmMsg.requestId).toBe(req.requestId);
      expect(pcmMsg.sampleRate).toBe(16000);
      // Downmix of [0.2, 0.4] is 0.3, [0.4, 0.6] is 0.5, [0.6, 0.8] is 0.7
      expect(pcmMsg.pcm[0]).toBeCloseTo(0.3, 4);
      expect(pcmMsg.pcm[1]).toBeCloseTo(0.5, 4);
      expect(pcmMsg.pcm[2]).toBeCloseTo(0.7, 4);

      // Simulate worker returning result
      worker.emitMessage({
        type: "result",
        requestId: req.requestId,
        transcript: {
          language: "en",
          duration: 0.1,
          granularity: "word",
          segments: [],
          words: [],
          stats: {
            model: "tiny",
            device: "wasm",
            dtype: "q8",
            loadMs: 0,
            decodeMs: 5,
            transcribeMs: 10,
            realTimeFactor: 5,
          },
        },
      });

      const result = await transcribePromise;
      expect(result.language).toBe("en");
    } finally {
      (globalThis as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext = originalOfflineCtx;
    }
  });
});
