import {
  RuntimeAbortError,
  createInMemoryGpuLock,
  createRuntime,
  createWebLocksGpuLock,
  defaultGpuLock,
} from "../src/index.js";
import type { Stage, VisibilitySource } from "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

function stage<In, Out>(
  name: string,
  run: Stage<In, Out>["run"],
  resource: Stage<In, Out>["resource"] = "cpu",
  extra: Partial<Stage<In, Out>> = {},
): Stage<In, Out> {
  return {
    name,
    resource,
    run,
    release: async () => undefined,
    ...extra,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs stages in order, chains outputs, and returns input for no stages", async () => {
    const seen: unknown[] = [];
    const runtime = createRuntime({ gpuAvailable: false });
    const result = await runtime.runJob([
      stage("one", async (input) => {
        seen.push(input);
        return `${input}-one`;
      }),
      stage("two", async (input) => {
        seen.push(input);
        return `${input}-two`;
      }),
    ], "start");

    expect(result).toBe("start-one-two");
    expect(seen).toEqual(["start", "start-one"]);
    await expect(runtime.runJob([], "unchanged")).resolves.toBe("unchanged");
  });

  it("reports weighted, clamped, non-decreasing progress", async () => {
    const progress: number[] = [];
    const runtime = createRuntime({ gpuAvailable: false });
    await runtime.runJob([
      stage("short", async (_input, context) => {
        context.reportProgress(0.5);
        context.reportProgress(0.1);
        context.reportProgress(2);
        return "middle";
      }, "cpu", { weight: 1 }),
      stage("long", async (_input, context) => {
        context.reportProgress(-1);
        context.reportProgress(0.5);
        return "done";
      }, "cpu", { weight: 3 }),
    ], "start", { onProgress: (value) => progress.push(value.fraction) });

    expect(progress).toEqual([0.125, 0.125, 0.25, 0.25, 0.25, 0.625, 1]);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("serializes GPU stages across runtimes sharing one lock", async () => {
    const lock = createInMemoryGpuLock();
    const firstGate = deferred<string>();
    let active = 0;
    let maximum = 0;
    const makeStage = (name: string, gate: Promise<string>): Stage<unknown, string> => stage(
      name,
      async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        const result = await gate;
        active -= 1;
        return result;
      },
      "gpu",
    );
    const first = createRuntime({ gpuAvailable: true, gpuLock: lock });
    const second = createRuntime({ gpuAvailable: true, gpuLock: lock });
    const firstJob = first.runJob([makeStage("first", firstGate.promise)], undefined);
    await flush();
    await flush();
    const secondJob = second.runJob([makeStage("second", Promise.resolve("second"))], undefined);
    await flush();
    expect(maximum).toBe(1);
    firstGate.resolve("first");
    await expect(firstJob).resolves.toBe("first");
    await expect(secondJob).resolves.toBe("second");
  });

  it("lets CPU stages overlap", async () => {
    const firstGate = deferred<string>();
    const secondGate = deferred<string>();
    let active = 0;
    let maximum = 0;
    const makeStage = (name: string, gate: Promise<string>): Stage<unknown, string> => stage(name, async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      const result = await gate;
      active -= 1;
      return result;
    });
    const firstJob = createRuntime({ gpuAvailable: false }).runJob([makeStage("one", firstGate.promise)], undefined);
    const secondJob = createRuntime({ gpuAvailable: false }).runJob([makeStage("two", secondGate.promise)], undefined);
    await flush();
    expect(maximum).toBe(2);
    firstGate.resolve("one");
    secondGate.resolve("two");
    await expect(firstJob).resolves.toBe("one");
    await expect(secondJob).resolves.toBe("two");
  });

  it("releases before the next waiting GPU stage starts", async () => {
    const lock = createInMemoryGpuLock();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = stage("first", async () => "one", "gpu", {
      release: () => new Promise<void>((resolve) => {
        releaseFirst = () => {
          order.push("release");
          resolve();
        };
      }),
    });
    const second = stage("second", async () => {
      order.push("run");
      return "two";
    }, "gpu");
    const firstJob = createRuntime({ gpuAvailable: true, gpuLock: lock }).runJob([first], undefined);
    await flush();
    await flush();
    const secondJob = createRuntime({ gpuAvailable: true, gpuLock: lock }).runJob([second], undefined);
    await flush();
    expect(order).toEqual([]);
    releaseFirst();
    await expect(firstJob).resolves.toBe("one");
    await expect(secondJob).resolves.toBe("two");
    expect(order).toEqual(["release", "run"]);
  });

  it.each(["success", "failure", "cancel"])("calls release exactly once after %s", async (outcome) => {
    const controller = new AbortController();
    let releases = 0;
    const testStage = stage("stage", async (_input, context) => {
      if (outcome === "failure") {
        throw new Error("failure");
      }
      if (outcome === "cancel") {
        context.signal.addEventListener("abort", () => undefined);
        return new Promise<string>(() => undefined);
      }
      return "ok";
    }, "cpu", { release: async () => { releases += 1; } });
    const job = createRuntime({ gpuAvailable: false, cancelGraceMs: 10 }).runJob([testStage], undefined, {
      signal: controller.signal,
    });
    if (outcome === "cancel") {
      controller.abort();
      await expect(job).rejects.toBeInstanceOf(RuntimeAbortError);
    } else if (outcome === "failure") {
      await expect(job).rejects.toThrow("failure");
    } else {
      await expect(job).resolves.toBe("ok");
    }
    expect(releases).toBe(1);
  });

  it("keeps the original error when release throws", async () => {
    const original = new Error("original");
    const events: string[] = [];
    const runtime = createRuntime({
      gpuAvailable: false,
      onEvent: (event) => {
        if (event.type === "release-error") events.push(event.message);
      },
    });
    const failing = stage("failing", async () => { throw original; }, "cpu", {
      release: async () => { throw new Error("release failed"); },
    });
    await expect(runtime.runJob([failing], undefined)).rejects.toBe(original);
    expect(events).toEqual(["release failed"]);
  });

  it("times out a hanging release and frees the lock", async () => {
    vi.useFakeTimers();
    let terminateCalls = 0;
    const lock = createInMemoryGpuLock();
    const hanging = stage("hanging", async () => "first", "gpu", {
      release: () => new Promise<void>(() => undefined),
      terminate: () => { terminateCalls += 1; },
    });
    const next = stage("next", async () => "second", "gpu");
    const events: string[] = [];
    const runtime = createRuntime({ gpuAvailable: true, gpuLock: lock, releaseTimeoutMs: 20, onEvent: (event) => {
      if (event.type === "terminated") events.push(event.reason);
    } });
    const firstJob = runtime.runJob([hanging], undefined);
    await flush();
    const secondJob = runtime.runJob([next], undefined);
    await flush();
    await vi.advanceTimersByTimeAsync(20);
    await expect(firstJob).resolves.toBe("first");
    await expect(secondJob).resolves.toBe("second");
    expect(terminateCalls).toBe(1);
    expect(events).toEqual(["release-timeout"]);
  });

  it("cancels a quickly stopping stage and skips later stages", async () => {
    const controller = new AbortController();
    let laterRuns = 0;
    const first = stage("first", async (_input, context) => new Promise<string>((resolve) => {
      context.signal.addEventListener("abort", () => resolve("ignored"), { once: true });
    }), "cpu");
    const later = stage("later", async () => { laterRuns += 1; return "later"; });
    const job = createRuntime({ gpuAvailable: false }).runJob([first, later], undefined, { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(job).rejects.toMatchObject({ name: "AbortError" });
    expect(laterRuns).toBe(0);
  });

  it("terminates a stage that ignores cancellation after the grace period", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let terminated = 0;
    const events: string[] = [];
    const ignoring = stage("ignoring", async () => new Promise<string>(() => undefined), "cpu", {
      terminate: () => { terminated += 1; },
    });
    const job = createRuntime({ gpuAvailable: false, cancelGraceMs: 25, onEvent: (event) => {
      if (event.type === "terminated") events.push(event.reason);
    } }).runJob([ignoring], undefined, { signal: controller.signal });
    const rejection = expect(job).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    controller.abort();
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(terminated).toBe(1);
    expect(events).toEqual(["cancel-timeout"]);
  });

  it("removes a cancelled waiter from the GPU lock queue", async () => {
    const lock = createInMemoryGpuLock();
    const held = deferred<void>();
    let waitingRuns = 0;
    const first = stage("held", async () => held.promise, "gpu");
    const waiting = stage("waiting", async () => { waitingRuns += 1; return "waiting"; }, "gpu");
    const controller = new AbortController();
    const firstJob = createRuntime({ gpuAvailable: true, gpuLock: lock }).runJob([first], undefined);
    await flush();
    const waitingJob = createRuntime({ gpuAvailable: true, gpuLock: lock }).runJob([waiting], undefined, { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(waitingJob).rejects.toMatchObject({ name: "AbortError" });
    held.resolve();
    await expect(firstJob).resolves.toBeUndefined();
    await expect(createRuntime({ gpuAvailable: true, gpuLock: lock }).runJob([waiting], undefined)).resolves.toBe("waiting");
    expect(waitingRuns).toBe(1);
  });

  it("rejects an already-aborted job without running a stage", async () => {
    const controller = new AbortController();
    controller.abort();
    let runs = 0;
    const testStage = stage("never", async () => { runs += 1; return "never"; });
    await expect(createRuntime({ gpuAvailable: false }).runJob([testStage], undefined, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(runs).toBe(0);
  });

  it("falls back after GPU loss and keeps the runtime unhealthy", async () => {
    const devices: string[] = [];
    let runs = 0;
    const lost = new Error("lost");
    lost.name = "GpuLostError";
    const testStage = stage("gpu", async (_input, context) => {
      devices.push(context.device);
      runs += 1;
      if (runs === 1) throw lost;
      return "ok";
    }, "gpu", { supportsWasmFallback: true });
    const runtime = createRuntime({ gpuAvailable: true });
    await expect(runtime.runJob([testStage], undefined)).resolves.toBe("ok");
    expect(devices).toEqual(["webgpu", "wasm"]);
    expect(runtime.health()).toEqual({ webgpu: "unhealthy" });
    const nextDevices: string[] = [];
    await runtime.runJob([stage("next", async (_input, context) => {
      nextDevices.push(context.device);
      return "next";
    }, "gpu")], undefined);
    expect(nextDevices).toEqual(["wasm"]);
  });

  it("rejects the original GPU loss without fallback", async () => {
    const lost = new Error("lost");
    lost.name = "GpuLostError";
    const runtime = createRuntime({ gpuAvailable: true });
    await expect(runtime.runJob([stage("gpu", async () => { throw lost; }, "gpu")], undefined)).rejects.toBe(lost);
    expect(runtime.health()).toEqual({ webgpu: "unhealthy" });
  });

  it("does not retry a failed WASM fallback", async () => {
    const lost = new Error("lost");
    lost.name = "GpuLostError";
    let runs = 0;
    const testStage = stage("gpu", async () => {
      runs += 1;
      throw lost;
    }, "gpu", { supportsWasmFallback: true });
    await expect(createRuntime({ gpuAvailable: true }).runJob([testStage], undefined)).rejects.toBe(lost);
    expect(runs).toBe(2);
  });

  it("reports unavailable GPU and uses WASM", async () => {
    let device = "";
    const runtime = createRuntime({ gpuAvailable: false });
    await runtime.runJob([stage("gpu", async (_input, context) => {
      device = context.device;
      return "ok";
    }, "gpu")], undefined);
    expect(runtime.health()).toEqual({ webgpu: "unavailable" });
    expect(device).toBe("wasm");
  });

  it("adapts Web Locks and maps its abort error", async () => {
    const calls: unknown[] = [];
    const locks = {
      request: async <T>(name: string, options: { mode: "exclusive"; signal?: AbortSignal }, callback: () => Promise<T>) => {
        calls.push([name, options.mode, options.signal]);
        return callback();
      },
    };
    const lock = createWebLocksGpuLock(locks);
    const controller = new AbortController();
    await expect(lock.run(async () => "ok", controller.signal)).resolves.toBe("ok");
    expect(calls[0]).toEqual(["offcut-gpu", "exclusive", controller.signal]);
    const abortingLock = createWebLocksGpuLock({
      request: async () => { throw new DOMException("aborted", "AbortError"); },
    });
    await expect(abortingLock.run(async () => "never", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("shares the fallback lock instance when Web Locks are absent", () => {
    const existingLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(defaultGpuLock()).toBe(defaultGpuLock());
    Object.defineProperty(navigator, "locks", { configurable: true, value: existingLocks });
  });

  it("emits timing, memory, visibility, and ignores throwing observers", async () => {
    let hidden = false;
    let unsubscribeCalls = 0;
    let onChange!: () => void;
    const visibility: VisibilitySource = {
      isHidden: () => hidden,
      subscribe: (callback) => {
        onChange = callback;
        return () => { unsubscribeCalls += 1; };
      },
    };
    let clock = 10;
    const events: Array<{ type: string; durationMs?: number; memoryBytes?: number }> = [];
    let memory = 100;
    const runtime = createRuntime({
      gpuAvailable: false,
      now: () => clock,
      memoryBytes: () => memory,
      visibility,
      onEvent: (event) => {
        events.push(event);
        throw new Error("observer");
      },
    });
    const job = runtime.runJob([stage("timed", async () => {
      hidden = true;
      onChange();
      clock = 35;
      memory = 200;
      return "done";
    })], undefined);
    await expect(job).resolves.toBe("done");
    expect(events.filter((event) => event.type === "stage-start")).toEqual([
      { type: "stage-start", stage: "timed", device: "wasm", at: 10, memoryBytes: 100 },
    ]);
    expect(events.filter((event) => event.type === "stage-end")).toEqual([
      { type: "stage-end", stage: "timed", at: 35, durationMs: 25, memoryBytes: 200 },
    ]);
    expect(events.filter((event) => event.type === "tab-hidden")).toHaveLength(1);
    expect(unsubscribeCalls).toBe(1);
  });
});
