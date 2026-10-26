import { RUNTIME_CONSTANTS } from "./constants.js";
import { RuntimeAbortError } from "./errors.js";
import type { GpuLock, LockManagerLike } from "./types.js";

interface Waiter<T> {
  fn: () => Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export function createInMemoryGpuLock(): GpuLock {
  const queue: Array<Waiter<unknown>> = [];
  let running = false;

  const drain = (): void => {
    if (running) {
      return;
    }

    const waiter = queue.shift();
    if (!waiter) {
      return;
    }

    if (waiter.signal?.aborted) {
      waiter.reject(new RuntimeAbortError());
      drain();
      return;
    }

    running = true;
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }

    Promise.resolve()
      .then(waiter.fn)
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        running = false;
        drain();
      })
      .catch(() => undefined);
  };

  return {
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) {
        return Promise.reject(new RuntimeAbortError());
      }

      return new Promise<T>((resolve, reject) => {
        const waiter: Waiter<T> = { fn, resolve, reject, signal };
        const onAbort = (): void => {
          const index = queue.indexOf(waiter as Waiter<unknown>);
          if (index !== -1) {
            queue.splice(index, 1);
            reject(new RuntimeAbortError());
          }
        };

        waiter.onAbort = onAbort;
        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }
        queue.push(waiter as Waiter<unknown>);
        drain();
      });
    },
  };
}

export function createWebLocksGpuLock(locks: LockManagerLike, name = RUNTIME_CONSTANTS.gpuLockName): GpuLock {
  return {
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      return locks.request(name, { mode: "exclusive", signal }, fn).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new RuntimeAbortError();
        }
        throw error;
      });
    },
  };
}

let pageLock: GpuLock | undefined;

export function defaultGpuLock(): GpuLock {
  const browserNavigator = typeof navigator === "undefined" ? undefined : navigator as Navigator & {
    locks?: LockManagerLike;
  };
  if (browserNavigator?.locks) {
    return createWebLocksGpuLock(browserNavigator.locks);
  }

  pageLock ??= createInMemoryGpuLock();
  return pageLock;
}
