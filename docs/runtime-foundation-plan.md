# Runtime foundation: plan

_Drafted 2026-10-26. Research only, no code yet._

## Goal

Let Offcut's heavy steps (transcription now; video decode, render and encode next) run in one browser tab without freezing it, running out of memory or losing the GPU. Do it with a **thin** layer: a few strict rules and one shared interface, not a full scheduler.

**In scope:** one interface every heavy step implements, a runner that enforces the rules below, the transcription engine wrapped in that interface, crash recovery, and local-only measurements.

**Out of scope (later, once there's a second real workload to measure):** running GPU steps in parallel, memory budgets, resumable jobs, priorities.

## Verified facts this plan relies on

Every item was checked in the installed source or the spec. File paths are under `engine/node_modules/`.

### ONNX Runtime Web (the library under Transformers.js)

- **Version in use:** Transformers.js 3.8.1 pins `onnxruntime-web` `1.22.0-dev.20250409-89f8206ba4`. It imports the default build (`@huggingface/transformers/src/backends/onnx.js` line 24), which runs WebGPU through the "JSEP" backend.
- **ORT creates and owns its own GPU device.** On the JSEP path it requests an adapter (`onnxruntime-web/lib/wasm/wasm-core-impl.ts` lines 125–156), then calls `adapter.requestDevice()` itself (`lib/wasm/jsep/backend-webgpu.ts` line 257). Afterwards it makes `env.webgpu.device` read-only (lines 277–282).
- **So we can't hand ORT a device we created.** The `env.webgpu.device` setter described in `onnxruntime-common/dist/esm/env.d.ts` (lines 200–212) only applies to the newer WebGPU EP build (`wasm-core-impl.ts` lines 108–111), not the JSEP build we use. We *can* read ORT's device after the first session is created and use it ourselves, but only inside the same worker.
- **Releasing a session frees GPU memory only partly.** On release, ORT destroys that session's pending buffers. It clears its shared GPU buffer cache only when the **last** session is released (`lib/wasm/jsep/webgpu/gpu-data-manager.ts` lines 471–490). ORT never destroys its device.
- **ORT doesn't handle a lost device.** There is no `device.lost` handling in `backend-webgpu.ts`; it only logs validation errors (lines 270–275). After a GPU loss, that ORT instance can't be used again.
- **Transformers.js release:** `pipeline.dispose()` is async (`src/pipelines.js` line 182) and releases each ONNX session (`src/models.js` lines 1085–1093).
- **ORT's WASM files come from jsDelivr by default.** Transformers.js sets `wasmPaths` to `https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/` unless the app sets it (`src/backends/onnx.js` lines 205–212). Confirmed in a running page, where `env.backends.onnx.wasm.wasmPaths` reports that URL. Our build bundles `ort-wasm-simd-threaded.jsep.wasm` (21.6 MB) but never uses it.

### WebGPU (W3C spec)

- **One device per adapter.** "Each adapter object can only be used to create one device"; the adapter becomes `"consumed"` (§3.5.1).
- **A lost device stays lost.** A lost or destroyed device and everything created on it become unusable, and "an invalid object will never become valid" (§3.2.1, §3.5.2). Recovery means a new adapter and a new device. `device.lost` resolves with a reason; `device.destroy()` loses the device with reason `"destroyed"`.
- **GPU objects don't move between workers.** Objects belong to the timeline that created them (§3.1.2), and the spec defines no transfer. In practice: each worker gets its own device, and devices share the GPU's memory and time.
- **WebGPU works in workers:** `GPU` is `[Exposed=(Window, Worker), SecureContext]`.

### WebCodecs (W3C spec)

- **Codecs run in dedicated workers:** `Exposed=(Window,DedicatedWorker)`.
- **Frames must be closed.** The decoder owns the frames' memory, and not calling `close()` promptly "can cause decoding to stall".
- **`VideoFrame` is transferable.** Transferring it closes the sender's copy, so frames can move between workers without copying.
- **The browser may shut down idle or background codecs** (§11, Resource Reclamation).
  - A codec counts as **active** if it has made progress in the last 10 seconds, and as **background** if its page is hidden.
  - The browser may reclaim codecs that are inactive or in the background, and closes them with a `QuotaExceededError`.
  - It never reclaims a codec that is both active and in the foreground.
  - Encoders, decoders paired with an active encoder, and audio decoders in an audibly playing tab are protected even in the background.

### Memory measurement

- **`performance.measureUserAgentSpecificMemory()`** requires a cross-origin-isolated page. We can't use it, because COOP/COEP headers are ruled out so ads work.
- **`performance.memory`** is non-standard, Chromium-only and deprecated, and covers the JavaScript heap only. MDN calls it unreliable with workers.
- **There is no API to read GPU memory use.**

### Other

- **Web Locks (`navigator.locks`)** works in workers and across tabs of the same origin, needs no cross-origin isolation, and has been Baseline since March 2022.
- **Cloudflare Pages allows files up to 25 MiB,** so the 21.6 MB ORT WASM file can be self-hosted.

## Problems in the current engine the foundation must fix

1. **The model's release isn't awaited.** `disposePipeline()` calls the async `dispose()` without `await` (`engine/src/whisper/worker.ts`, around line 690), so the worker can carry on before the GPU memory is freed.
2. **The VAD session is never released.** `SileroVadRunner.dispose()` only drops its reference; it never calls the ORT session's release. Releasing the Whisper pipeline may therefore not be "the last session", which would keep ORT's GPU buffer cache alive. Not yet measured, because VAD runs on the WASM backend.
3. **No GPU-loss handling.** If the GPU is lost mid-job, the worker is stuck with an unusable ORT instance.
4. **WASM files come from a third-party CDN.** No media is sent, but every user's browser contacts jsDelivr, and the engine breaks offline or if jsDelivr is blocked.
5. **The only complete release is ending the worker.** Because ORT never destroys its device and keeps a buffer cache, `worker.terminate()` is the only way to guarantee all of Whisper's GPU memory is returned.

## The rules

1. **Heavy work never runs on the main thread.** Decode, inference, render and encode each run in a dedicated worker. The main thread only does UI.
2. **One GPU-heavy step at a time,** enforced with a Web Lock named `offcut-gpu`. Because Web Locks span tabs, two Offcut tabs also take turns instead of fighting.
3. **Release means the worker is gone.** When a GPU step gives up the lock, its worker is terminated. A step may keep its model loaded between jobs only while no other step is waiting for the lock. Reloading from the browser cache is cheap: we measured `loadMs` at about 1–2 s for `tiny` and `base`.
4. **GPU loss.** Each GPU worker watches its device (for ORT, the device it reads from `env.webgpu.device` after loading) and reports `gpu-lost`. The runner then:
   - terminates that worker;
   - marks WebGPU as unhealthy for the rest of the session;
   - retries the step once on WASM if the step supports it, or fails with a plain-language message.

   No retry loops.
5. **Codec discipline.**
   - Open decoders and encoders inside the step that uses them, and close them when it ends.
   - Never leave a decoder idle across another step, since idle for 10 s means it can be reclaimed.
   - Treat `QuotaExceededError` as "recreate the codec and retry once".
   - Close every `VideoFrame`, transfer frames between workers instead of copying them, and cap how many frames are in flight.
6. **Hidden-tab warning.** Long jobs watch the Page Visibility API and warn when the tab is hidden, because background codecs can be reclaimed and background timers are throttled.
7. **Cancelling.** One `AbortSignal` per job. A step must stop within 2 s of a cancel, or the runner terminates its worker.
8. **One progress model.** Each job reports a single 0–100% figure, weighted by step, plus the current step's own progress.
9. **Local measurements only.** For each step, record wall time, load time, `performance.memory` before and after (Chromium only, rough), GPU-lost count and codec-reclaimed count. These are shown in a developer panel and never sent anywhere.
10. **Self-host ORT's WASM.** Set `env.backends.onnx.wasm.wasmPaths` to our own bundled file so the engine makes no third-party requests except model downloads from Hugging Face. This is the owner's decision, listed under open questions.

## Interface sketch (illustrative, not final)

```ts
type ResourceClass = "gpu" | "cpu" | "io";

interface StageContext {
  signal: AbortSignal;
  reportProgress(fraction: number, detail?: string): void;
  log(event: RuntimeEvent): void;          // local measurements only
}

interface Stage<In, Out> {
  name: string;
  resource: ResourceClass;
  run(input: In, ctx: StageContext): Promise<Out>;
  release(): Promise<void>;                // must leave no GPU or codec resources behind
  supportsWasmFallback?: boolean;
}

interface Runtime {
  runJob<T>(stages: Stage<any, any>[], input: unknown, signal: AbortSignal,
            onProgress: (p: JobProgress) => void): Promise<T>;
  health(): { webgpu: "ok" | "unhealthy" | "unavailable" };
}
```

The transcription engine becomes a `Stage` by wrapping `createTranscriber()`. It already supports `AbortSignal`, progress and `dispose()`, so it doesn't need rewriting.

## Where it lives

A new `runtime/` package next to `engine/`, with the same tooling (TypeScript strict, Vite, Vitest). It depends on nothing heavy and never imports `engine/`. The future app wires the two together. This keeps the engine usable on its own and keeps the runtime testable without a GPU.

## Milestones

| # | What | Done when |
|---|---|---|
| M0 | **Engine hygiene** (small changes in `engine/`): await `dispose()`; release the VAD session properly; report `gpu-lost` from the worker; self-host the WASM files if the owner approves | Tests pass; with WASM self-hosted, no requests to jsDelivr in a run; a forced `device.destroy()` reaches the main thread as `gpu-lost` |
| M1 | **Runtime core** in `runtime/`: `Stage`, the runner, the cross-tab GPU lock, cancelling, progress, events | Unit tests with fake steps: GPU steps never overlap (including across two runner instances), cancelling stops within 2 s, `release()` always runs (success, failure and cancel), a failed step never leaves the lock held |
| M2 | **Transcription step:** wrap the engine as a `Stage` with WASM fallback | Same transcript as calling the engine directly on the Tesla video and `EN_PODCAST_001` |
| M3 | **Stress test with a stand-in GPU step:** a WebCodecs encode of synthetic frames in a worker, alternated with transcription 10 times in one tab | No GPU loss, no freeze (main-thread long tasks under 200 ms), JS heap back near its starting level after each cycle, timings stable across cycles. A forced GPU loss in either step recovers once and the next job succeeds |
| M4 | **Docs:** `runtime/README.md`, plus an update to `HANDOFF.md` | — |

After M3, video decode, render and encode get built as `Stage`s on top of this.

## Risks and unknowns

- **GPU memory can't be measured,** only inferred from GPU losses and timings. That's why the rules are simple (one GPU step at a time, terminate on release) rather than budget-based.
- **Not measured yet:** whether a never-released VAD session really keeps Whisper's GPU cache alive. M0 removes the question either way.
- **Ending and restarting workers costs** about 1–2 s per GPU step per job (model reload from cache). That's acceptable for a clipper, and M3 measures it.
- **Behaviour on other browsers:** Safari and Firefox WebGPU and WebCodecs support differs. M3 runs on Chrome first; other browsers are a separate check.
- **Upgrading Transformers.js later** may switch ORT to the newer WebGPU EP, where an outside device can be supplied. The interface hides this, so the rules stay the same.

## Open questions for the owner

1. **Self-host the ORT WASM file (21.6 MB, under Cloudflare Pages' 25 MiB limit), or keep jsDelivr?** Recommended: self-host, for privacy and offline use.
2. **Who builds M0–M3:** Claude in this repo, or Gemini in Antigravity from a brief?
3. **Keep the model loaded between jobs, or always unload after each job?** Recommended: keep it loaded until another GPU step needs the lock.
