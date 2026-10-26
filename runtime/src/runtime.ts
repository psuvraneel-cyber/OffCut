import { RUNTIME_CONSTANTS } from "./constants.js";
import { RuntimeAbortError, isGpuLostError } from "./errors.js";
import { defaultGpuLock } from "./lock.js";
import { clampProgress, weightedProgress } from "./progress.js";
import type {
  Device,
  GpuLock,
  Runtime,
  RuntimeEvent,
  RuntimeOptions,
  Stage,
  StageContext,
  VisibilitySource,
} from "./types.js";

interface RunOutcome<T> {
  kind: "fulfilled" | "rejected";
  value?: T;
  error?: unknown;
}

interface CancelOutcome {
  kind: "cancelled";
  timedOut: boolean;
}

type AttemptOutcome<T> = RunOutcome<T> | CancelOutcome;

function defaultGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function defaultMemoryBytes(): number | undefined {
  if (typeof performance === "undefined") {
    return undefined;
  }

  const measuredPerformance = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  const value = measuredPerformance.memory?.usedJSHeapSize;
  return typeof value === "number" ? value : undefined;
}

function defaultVisibility(): VisibilitySource {
  if (typeof document === "undefined") {
    return {
      isHidden: () => false,
      subscribe: () => () => undefined,
    };
  }

  return {
    isHidden: () => document.visibilityState === "hidden",
    subscribe: (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const gpuLock: GpuLock = options.gpuLock ?? defaultGpuLock();
  const gpuAvailable = options.gpuAvailable ?? defaultGpuAvailable();
  const now = options.now ?? defaultNow;
  const memoryBytes = options.memoryBytes ?? defaultMemoryBytes;
  const visibility = options.visibility ?? defaultVisibility();
  const onEvent = options.onEvent;
  const cancelGraceMs = options.cancelGraceMs ?? RUNTIME_CONSTANTS.cancelGraceMs;
  const releaseTimeoutMs = options.releaseTimeoutMs ?? RUNTIME_CONSTANTS.releaseTimeoutMs;
  let gpuHealthy = true;

  const emit = (event: RuntimeEvent): void => {
    try {
      onEvent?.(event);
    } catch {
      // Event observers are local diagnostics and cannot control the job.
    }
  };

  const markGpuLost = (): void => {
    gpuHealthy = false;
  };

  const currentDevice = (): Device => gpuAvailable && gpuHealthy ? "webgpu" : "wasm";

  const releaseStage = async (stage: Stage<any, any>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const releaseResult = Promise.resolve()
      .then(() => stage.release())
      .then(
        () => ({ kind: "fulfilled" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "timeout" });
      }, releaseTimeoutMs);
    });
    const result = await Promise.race([releaseResult, timeout]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (result.kind === "timeout") {
      try {
        stage.terminate?.();
      } catch {
        // A failed hard-stop must not keep the lock or job stuck.
      }
      emit({ type: "terminated", stage: stage.name, at: now(), reason: "release-timeout" });
      return;
    }

    if (result.kind === "rejected") {
      emit({ type: "release-error", stage: stage.name, at: now(), message: errorMessage(result.error) });
    }

  };

  const runAttempt = async <In, Out>(
    stage: Stage<In, Out>,
    input: In,
    signal: AbortSignal,
    reportProgress: (fraction: number, detail?: string) => void,
  ): Promise<AttemptOutcome<Out>> => {
    const device = currentDevice();
    const startedAt = now();
    const startedMemory = memoryBytes();
    const startEvent: RuntimeEvent = {
      type: "stage-start",
      stage: stage.name,
      device,
      at: startedAt,
    };
    if (startedMemory !== undefined) {
      startEvent.memoryBytes = startedMemory;
    }
    emit(startEvent);

    let active = true;
    const context: StageContext = {
      signal,
      device,
      reportProgress: (fraction, detail) => {
        if (active) {
          reportProgress(fraction, detail);
        }
      },
    };
    const runPromise = Promise.resolve()
      .then(() => stage.run(input, context))
      .then(
        (value) => {
          active = false;
          return { kind: "fulfilled" as const, value };
        },
        (error: unknown) => {
          active = false;
          return { kind: "rejected" as const, error };
        },
      );

    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelResolve: ((outcome: CancelOutcome) => void) | undefined;
    const cancellation = new Promise<CancelOutcome>((resolve) => {
      cancelResolve = resolve;
    });
    const onAbort = (): void => {
      cancelTimer = setTimeout(() => {
        active = false;
        cancelResolve?.({ kind: "cancelled", timedOut: true });
      }, cancelGraceMs);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    let result: AttemptOutcome<Out>;
    if (signal.aborted) {
      result = { kind: "cancelled", timedOut: false };
    } else {
      result = await Promise.race([runPromise, cancellation]);
      if (result.kind !== "cancelled" && signal.aborted) {
        result = { kind: "cancelled", timedOut: false };
      }
    }
    signal.removeEventListener("abort", onAbort);
    if (cancelTimer !== undefined) {
      clearTimeout(cancelTimer);
    }

    if (result.kind === "cancelled") {
      if (result.timedOut) {
        try {
          stage.terminate?.();
        } catch {
          // Continue to cleanup even if a worker hard-stop throws.
        }
        emit({ type: "terminated", stage: stage.name, at: now(), reason: "cancel-timeout" });
      }
      await releaseStage(stage);
      return result;
    }

    if (result.kind === "fulfilled") {
      const endedAt = now();
      const endedMemory = memoryBytes();
      const endEvent: RuntimeEvent = {
        type: "stage-end",
        stage: stage.name,
        at: endedAt,
        durationMs: endedAt - startedAt,
      };
      if (endedMemory !== undefined) {
        endEvent.memoryBytes = endedMemory;
      }
      emit(endEvent);
      await releaseStage(stage);
      return result;
    }

    const failure = result.error;
    if (isGpuLostError(failure)) {
      markGpuLost();
      await releaseStage(stage);
      const willRetryOnWasm = stage.supportsWasmFallback === true && device === "webgpu";
      emit({ type: "gpu-lost", stage: stage.name, at: now(), willRetryOnWasm });
      return { kind: "rejected", error: failure };
    }

    const endedAt = now();
    emit({
      type: "stage-error",
      stage: stage.name,
      at: endedAt,
      durationMs: endedAt - startedAt,
      errorName: errorName(failure),
      message: errorMessage(failure),
    });
    await releaseStage(stage);
    return result;
  };

  const runStage = async (
    stage: Stage<any, any>,
    input: unknown,
    signal: AbortSignal,
    reportProgress: (fraction: number, detail?: string) => void,
  ): Promise<unknown> => {
    const execute = async (): Promise<unknown> => {
      if (signal.aborted) {
        throw new RuntimeAbortError();
      }

      const firstDevice = currentDevice();
      const first = await runAttempt(stage, input, signal, reportProgress);
      if (first.kind === "cancelled") {
        throw new RuntimeAbortError();
      }
      if (first.kind === "fulfilled") {
        return first.value;
      }
      if (!isGpuLostError(first.error)) {
        throw first.error;
      }
      if (stage.supportsWasmFallback !== true || firstDevice !== "webgpu") {
        throw first.error;
      }

      const retry = await runAttempt(stage, input, signal, reportProgress);
      if (retry.kind === "cancelled") {
        throw new RuntimeAbortError();
      }
      if (retry.kind === "fulfilled") {
        return retry.value;
      }
      throw retry.error;
    };

    if (stage.resource !== "gpu") {
      return execute();
    }

    emit({ type: "lock-wait", stage: stage.name, at: now() });
    return gpuLock.run(execute, signal);
  };

  return {
    health: () => ({ webgpu: gpuAvailable ? gpuHealthy ? "ok" : "unhealthy" : "unavailable" }),
    async runJob<Out>(
      stages: readonly Stage<any, any>[],
      input: unknown,
      jobOptions: { signal?: AbortSignal; onProgress?: (progress: import("./types.js").JobProgress) => void } = {},
    ): Promise<Out> {
      const signal = jobOptions.signal ?? new AbortController().signal;
      if (signal.aborted) {
        emit({ type: "cancelled", at: now() });
        throw new RuntimeAbortError();
      }

      const stageCount = stages.length;
      const weights = stages.map((stage) => stage.weight ?? 1);
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const shares = totalWeight === 0
        ? weights.map(() => 1 / (stageCount || 1))
        : weights.map((weight) => weight / totalWeight);
      let jobFraction = 0;
      let cancelledEmitted = false;
      let hiddenEmitted = false;
      const onAbort = (): void => {
        if (!cancelledEmitted) {
          cancelledEmitted = true;
          emit({ type: "cancelled", at: now() });
        }
      };
      const onVisibilityChange = (): void => {
        if (!hiddenEmitted && visibility.isHidden()) {
          hiddenEmitted = true;
          emit({ type: "tab-hidden", at: now() });
        }
      };
      const unsubscribe = visibility.subscribe(onVisibilityChange);
      signal.addEventListener("abort", onAbort, { once: true });
      onVisibilityChange();

      const reportStageProgress = (stageIndex: number, fraction: number, detail?: string): void => {
        const stageFraction = clampProgress(fraction);
        const completed = shares.slice(0, stageIndex).reduce((sum, share) => sum + share, 0);
        jobFraction = Math.max(jobFraction, weightedProgress(completed, shares[stageIndex] ?? 0, stageFraction));
        try {
          jobOptions.onProgress?.({
            fraction: jobFraction,
            stage: stages[stageIndex]?.name ?? "",
            stageIndex,
            stageCount,
            stageFraction,
            ...(detail === undefined ? {} : { detail }),
          });
        } catch {
          // Progress observers are also local and cannot break execution.
        }
      };

      try {
        let current = input;
        for (let index = 0; index < stages.length; index += 1) {
          if (signal.aborted) {
            throw new RuntimeAbortError();
          }
          current = await runStage(
            stages[index],
            current,
            signal,
            (fraction, detail) => reportStageProgress(index, fraction, detail),
          );
          reportStageProgress(index, 1);
        }
        if (signal.aborted) {
          throw new RuntimeAbortError();
        }
        return current as Out;
      } catch (error: unknown) {
        if (signal.aborted && !cancelledEmitted) {
          onAbort();
        }
        throw error;
      } finally {
        signal.removeEventListener("abort", onAbort);
        unsubscribe();
      }
    },
  };
}
