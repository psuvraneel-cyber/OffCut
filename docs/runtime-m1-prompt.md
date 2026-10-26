# Runtime foundation M1 prompt (for Omnirush)

Copy everything below the line into Omnirush.

---

## Who you are and what this is

You are a senior TypeScript engineer who writes small, well-tested libraries. You're building a **new, self-contained package** inside an existing project. **Don't change anything outside it.**

**The project:** Offcut is a free, open-source, in-browser AI video clipper. Long videos go in, captioned vertical Reels come out. **Everything runs on the user's own device:** speech recognition (Whisper on WebGPU, with a CPU/WASM fallback), and later video decode, render and encode with WebCodecs. The budget is zero.

**The problem this solves.** Several heavy steps will run in one browser tab. Each step uses the GPU or a lot of memory through its own Web Worker. If two GPU-heavy steps run at once, the tab can freeze, run out of memory or lose its GPU device. We prevent that with a **thin runtime** that runs a job's steps in order, lets only **one GPU-heavy step run at a time** (across tabs too), always releases resources, handles cancelling and GPU loss, and reports progress. The full design and the verified facts behind it are in `docs/runtime-foundation-plan.md`. **This task is milestone M1: the runtime core only, tested with fake steps.** No real GPU, worker or engine code is involved.

A reviewer (Claude) checks your work afterwards against this prompt and the code, so **report honestly**, including anything you couldn't do or verify.

## Where you work

- **Folder:** `C:\OffCut-runtime`. This is a git worktree of the project on branch **`feat/runtime-m1`**, created by the owner. All paths below are relative to it.
- **Never touch `C:\OffCut` itself or any other folder.** Another AI is working in `C:\OffCut-captions` at the same time.
- **You create and work only in a new folder, `runtime/`.**

## Read these first

1. `HANDOFF.md`: project overview and decisions.
2. `docs/runtime-foundation-plan.md`: the design and verified facts. **This prompt overrides it where they differ.**
3. `engine/package.json`, `engine/tsconfig.json`, `engine/vitest.config.ts`: copy their tooling style for the new package.
4. `engine/src/errors.ts`: the engine's error classes. The runtime recognises the engine's `GpuLostError` **by `error.name === "GpuLostError"`** and must **not** import anything from `engine/`.

## Hard rules (breaking any of these fails the task)

1. **Only create and edit files inside `runtime/`.** Don't change `engine/`, `web/`, `functions/`, `shared/`, `migrations/`, `test/`, `docs/`, `HANDOFF.md`, the root `package.json`, the root lockfile, `.gitignore` or anything else.
2. **Dependencies:** only three dev dependencies, at the same versions as `engine/package.json`: `typescript`, `vitest` and `@types/node`. No runtime dependencies at all.
3. **Git:**
   - You may commit, **only on `feat/runtime-m1`**, with clear messages.
   - Never push, merge, rebase, switch branches, stash or reset.
   - Never touch `main`.
4. **Never run the root `npm run build`.** Run npm only inside `runtime/` (`npm --prefix runtime ...`).
5. **No network, no analytics.** Events are local only: callbacks the caller receives, never sent anywhere.
6. **No cross-origin isolation, no `SharedArrayBuffer`.**
7. **Code style** (same as `engine/`):
   - TypeScript `strict`, `erasableSyntaxOnly` (no `enum`, no constructor parameter properties), `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
   - Double quotes, semicolons, 2-space indent, `#private` fields, small pure functions, sparse comments.
   - Every tunable number in one exported constants object.
8. **Browser APIs must be injectable,** so everything is testable in Node: Web Locks, `performance.memory`, the page's visibility, the clock and `navigator.gpu` detection. **Don't guess APIs.** For Web Locks, follow the API as MDN documents it: `navigator.locks.request(name, { mode, signal }, callback)`. If anything here is unclear, choose the simplest reading and report it.

## Package layout

```
runtime/
  package.json        name "offcut-runtime", private, "type": "module",
                      scripts: "typecheck": "tsc --noEmit", "test": "vitest run"
  tsconfig.json       like engine's: lib ["ES2022", "DOM", "WebWorker"], strict, noEmit,
                      types ["node", "vitest/globals"], include ["src", "test"]
  vitest.config.ts    like engine's
  README.md
  src/
    index.ts          public exports only
    types.ts          Stage, StageContext, JobProgress, RuntimeEvent, RuntimeOptions, GpuLock, VisibilitySource
    errors.ts         RuntimeAbortError (name "AbortError"), isGpuLostError(error)
    constants.ts      RUNTIME_CONSTANTS
    lock.ts           createWebLocksGpuLock(locks), createInMemoryGpuLock(), defaultGpuLock()
    progress.ts       pure progress maths
    runtime.ts        createRuntime(options)
  test/
    *.test.ts
```

## The API (implement exactly this; you may add private helpers)

```ts
export const RUNTIME_CONSTANTS = {
  gpuLockName: "offcut-gpu",
  cancelGraceMs: 2000,     // a step must settle within this after a cancel, or it is terminated
  releaseTimeoutMs: 5000,  // release() longer than this is abandoned (step terminated) and the job moves on
} as const;

export type ResourceClass = "gpu" | "cpu" | "io";
export type Device = "webgpu" | "wasm";

export interface StageContext {
  signal: AbortSignal;              // aborts when the job is cancelled
  device: Device;                   // which device a GPU step should use this time
  reportProgress(fraction: number, detail?: string): void; // 0..1 within this step
}

export interface Stage<In = unknown, Out = unknown> {
  readonly name: string;
  readonly resource: ResourceClass;
  readonly weight?: number;                 // share of the job's progress; default 1
  readonly supportsWasmFallback?: boolean;  // may be retried once on "wasm" after a GPU loss
  run(input: In, context: StageContext): Promise<Out>;
  release(): Promise<void>;                 // must free everything the step holds; always called
  terminate?(): void;                       // hard stop (e.g. worker.terminate()) for a step that won't stop
}

export interface JobProgress {
  fraction: number;        // whole job, 0..1, never decreases
  stage: string;           // current step's name
  stageIndex: number;      // 0-based
  stageCount: number;
  stageFraction: number;   // 0..1
  detail?: string;
}

export type RuntimeEvent =
  | { type: "lock-wait"; stage: string; at: number }
  | { type: "stage-start"; stage: string; device: Device; at: number; memoryBytes?: number }
  | { type: "stage-end"; stage: string; at: number; durationMs: number; memoryBytes?: number }
  | { type: "stage-error"; stage: string; at: number; durationMs: number; errorName: string; message: string }
  | { type: "gpu-lost"; stage: string; at: number; willRetryOnWasm: boolean }
  | { type: "release-error"; stage: string; at: number; message: string }
  | { type: "terminated"; stage: string; at: number; reason: "cancel-timeout" | "release-timeout" }
  | { type: "cancelled"; at: number }
  | { type: "tab-hidden"; at: number };

export interface GpuLock {
  // Runs fn while holding the exclusive lock. Rejects with RuntimeAbortError if signal aborts while waiting.
  run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export interface VisibilitySource {
  isHidden(): boolean;
  subscribe(onChange: () => void): () => void; // returns unsubscribe
}

export interface RuntimeOptions {
  gpuLock?: GpuLock;                     // default: defaultGpuLock()
  gpuAvailable?: boolean;                // default: typeof navigator !== "undefined" && "gpu" in navigator
  now?: () => number;                    // default: performance.now()
  memoryBytes?: () => number | undefined;// default: performance.memory?.usedJSHeapSize (Chromium only), else undefined
  visibility?: VisibilitySource;         // default: document visibility if document exists, else never hidden
  onEvent?: (event: RuntimeEvent) => void;
  cancelGraceMs?: number;
  releaseTimeoutMs?: number;
}

export interface Runtime {
  runJob<Out>(
    stages: readonly Stage<any, any>[],
    input: unknown,
    options?: { signal?: AbortSignal; onProgress?: (progress: JobProgress) => void },
  ): Promise<Out>;
  health(): { webgpu: "ok" | "unhealthy" | "unavailable" };
}

export function createRuntime(options?: RuntimeOptions): Runtime;
export function createWebLocksGpuLock(locks: LockManagerLike, name?: string): GpuLock;
export function createInMemoryGpuLock(): GpuLock;
export function defaultGpuLock(): GpuLock; // Web Locks if navigator.locks exists, else ONE shared in-memory lock per page
export class RuntimeAbortError extends Error {} // name "AbortError"
export function isGpuLostError(error: unknown): boolean; // error?.name === "GpuLostError"
```

`LockManagerLike` is the minimal shape you need from `navigator.locks`. Define it in `types.ts`.

## Behaviour rules

1. **Order.** Steps run one after another. Step *i*'s output is step *i+1*'s input. `runJob` resolves with the last step's output, or with `input` if there are no steps.
2. **The GPU lock.**
   - A `"gpu"` step's `run()` **and** its `release()` both happen inside `gpuLock.run(...)`, so the next GPU step (in this runtime, another runtime or another tab) can't start until the previous one has released.
   - `"cpu"` and `"io"` steps don't take the lock.
   - Emit `lock-wait` just before waiting for the lock.
3. **Release always runs.** After every step, whether it succeeded, failed or was cancelled, call `release()` and wait for it.
   - If `release()` throws, emit `release-error` and carry on. A release error must **never** replace the step's own error.
   - If `release()` doesn't finish within `releaseTimeoutMs`, call `terminate?.()`, emit `terminated` with reason `"release-timeout"`, and carry on.
   - The lock is always given back, even then.
4. **Device.**
   - A step's `context.device` is `"webgpu"` when `gpuAvailable` is true and WebGPU health is `"ok"`. Otherwise it's `"wasm"`.
   - `health().webgpu` is `"unavailable"` if `gpuAvailable` is false, `"unhealthy"` after any GPU loss (for the rest of this runtime's life), else `"ok"`.
5. **GPU loss.** If a step's `run()` rejects with an error where `isGpuLostError(error)` is true:
   - Mark WebGPU unhealthy and release the step.
   - If `supportsWasmFallback` is true, emit `gpu-lost` with `willRetryOnWasm: true` and run the step **once more** with `device: "wasm"`. If that retry also fails, the job rejects with that error. **Never retry twice.**
   - If `supportsWasmFallback` isn't true, emit `gpu-lost` with `willRetryOnWasm: false` and reject the job with the original error.
6. **Cancelling** (`signal` aborts):
   - **While waiting for the lock:** stop waiting, don't run the step, reject with `RuntimeAbortError`.
   - **While a step runs:** the step's `context.signal` aborts. If `run()` settles within `cancelGraceMs`, release it and reject the job with `RuntimeAbortError`. If it doesn't, call `terminate?.()`, emit `terminated` with reason `"cancel-timeout"`, release it (with the release timeout), and reject with `RuntimeAbortError`.
   - Emit `cancelled` once.
   - A signal that's already aborted before `runJob` rejects immediately with `RuntimeAbortError`, without running anything.
   - Later steps never start after a cancel.
7. **Errors.** Any other error from `run()`: emit `stage-error`, release the step, reject the job with **the same error object**. Later steps don't run.
8. **Progress.**
   - Weights are each step's `weight` (default 1) divided by the sum.
   - `reportProgress` values are clamped to 0..1.
   - The job's `fraction` never decreases, even if a step reports a lower value or is retried on WASM.
   - When a step finishes, report its full share.
   - When the job succeeds, the last report has `fraction: 1`.
   - Calls after a step has finished are ignored.
9. **Events.**
   - `stage-start` and `stage-end` carry `at` from `now()`, plus `durationMs` and `memoryBytes` when `memoryBytes()` returns a number.
   - `tab-hidden` is emitted **at most once per job**, when the visibility source reports hidden while a job runs (or is hidden when it starts).
   - Unsubscribe from visibility when the job ends.
   - An `onEvent` callback that throws must not break the job: catch and ignore.
10. **Lock implementations.**
    - **`createInMemoryGpuLock()`:** a FIFO queue. Waiters whose signal aborts are removed from the queue and rejected with `RuntimeAbortError`. The lock is released when `fn` settles, whether it resolves or rejects.
    - **`createWebLocksGpuLock(locks, name)`:** calls `locks.request(name, { mode: "exclusive", signal }, fn)`. If the request rejects because the signal aborted (a `DOMException` named `"AbortError"`), reject with `RuntimeAbortError`. Pass through `fn`'s own result or error.
    - **`defaultGpuLock()`:** returns the Web Locks version when `globalThis.navigator?.locks` exists. Otherwise it returns a single in-memory lock created once per module, so two runtimes in one page share it.

## Tests (Vitest; use fake steps and `vi.useFakeTimers()` where timing matters)

Each test asserts exact values. All of these are required:

1. Three steps run in order, outputs chain, and the result is the last output. No steps returns the input.
2. Progress with weights `[1, 3]`: fractions are exactly as expected, never decrease, and end at 1. Out-of-range values are clamped. A step reporting lower again doesn't lower the job's fraction.
3. **Two runtimes sharing one in-memory lock** each run a job with a GPU step, started at the same time. A shared counter of active GPU steps never exceeds 1, and both jobs succeed.
4. Two `"cpu"` steps in two concurrent jobs **do** overlap (no lock).
5. A GPU step's `release()` finishes **before** the next waiting GPU step's `run()` starts.
6. `release()` is called exactly once after success, after failure and after cancel.
7. `release()` throws: the job still rejects with the step's original error (or resolves, if the step succeeded), and `release-error` is emitted.
8. `release()` hangs: after `releaseTimeoutMs` (fake timers), `terminate` is called, `terminated` with reason `"release-timeout"` is emitted, the lock is free, and the next job runs.
9. Cancel during `run()` when the step stops quickly: rejects with `RuntimeAbortError` (name `"AbortError"`), `release` is called, and later steps don't run.
10. Cancel during `run()` when the step ignores the signal: after `cancelGraceMs`, `terminate` is called, `terminated` with reason `"cancel-timeout"` is emitted, and the job rejects with `RuntimeAbortError`.
11. Cancel while waiting for the lock: the waiting step's `run()` is never called, and the lock queue holds no stale waiter. The next job still runs.
12. An already-aborted signal: rejects immediately, and no step runs.
13. `GpuLostError` (a plain `Error` with name set to `"GpuLostError"`) on a step with `supportsWasmFallback`: `health()` becomes `"unhealthy"`, the step runs again with `device: "wasm"`, and the job succeeds. The next job's steps get `device: "wasm"`.
14. `GpuLostError` on a step without fallback: the job rejects with that same error object, and health is `"unhealthy"`.
15. A WASM retry that fails again with `GpuLostError`: the job rejects, and the step ran exactly twice.
16. `gpuAvailable: false`: health is `"unavailable"`, and GPU steps get `device: "wasm"`.
17. `createWebLocksGpuLock` with a **fake** `locks` object: it calls `request` with the name `"offcut-gpu"`, mode `"exclusive"` and the given signal. A `DOMException("…", "AbortError")` from `request` becomes `RuntimeAbortError`.
18. `defaultGpuLock()` returns the same in-memory instance twice when no `navigator.locks` exists.
19. Events: `stage-start` and `stage-end` with `durationMs` from a fake clock. `memoryBytes` is present only when the sampler returns a number. An `onEvent` that throws doesn't break the job.
20. Visibility: a fake source reporting hidden mid-job emits exactly one `tab-hidden`, and the subscription is removed afterwards.

## README (`runtime/README.md`)

- What the runtime is for, and the rules: one GPU step at a time, release always runs, GPU loss falls back to WASM once, cancel grace and release timeout, local-only events.
- How a stage is written, with a short example: a fake GPU step that wraps a worker and calls `worker.terminate()` in `terminate()`.
- What M1 doesn't do yet: real stages (M2), the stress test (M3), parallel GPU steps, memory budgets, resumable jobs.

## Checks (all must pass)

1. `npm --prefix runtime install` (creates `runtime/package-lock.json`; commit it).
2. `npm --prefix runtime run typecheck`: no errors.
3. `npm --prefix runtime test`: all tests pass. Report the count.
4. `git status`: only `runtime/` files changed or added.

## The report

Reply with these sections, in order:

1. **Files added,** one line each.
2. **Check outputs:** exact lines and test counts.
3. **Any place where you interpreted this prompt** (which reading you chose, and why).
4. **Anything you couldn't do or verify,** and anything you noticed but didn't fix.
5. **Your commits** (`git log --oneline main..HEAD`).
