# Transcription engine build prompt (for Omnirush)

Copy everything below the line into Omnirush.

---

## Role and goal

You are a senior web engineer who specialises in in-browser media and on-device AI. Build the **transcription engine** for Offcut as a standalone TypeScript module in a new `engine/` folder, plus a small demo page to test it.

The engine takes a video or audio file the user picks, pulls out the sound, runs Whisper **entirely in the browser**, and returns every spoken word with its start and end time.

### What Offcut is (this shapes every decision)

Offcut is a free, open-source, in-browser AI video clipper. A creator drops in a long video (a podcast, vlog or lecture) and gets back short, captioned, vertical clips. **All processing happens on the user's own device.** "Your video never leaves your computer" is the product's main promise.

The budget is **zero**: no servers, no paid APIs, no paid services. Later, this engine powers the caption and clip-picking stages of the tool. Right now it's an isolated building block.

## Hard rules

1. **Stay in `engine/`.** Create and edit files only inside `engine/`. Do **not** touch `web/`, `functions/`, `shared/`, `migrations/`, `test/`, the root `package.json`, the root lockfile, `wrangler.toml` or `docs/`. Another AI is editing `web/` right now.
2. **No git commits, branches or staging.** Leave everything uncommitted; the owner will review and commit it.
3. **Never run the root `npm run build`.** `engine/` has its own `package.json` and lockfile; run all npm commands with `--prefix engine` or from inside `engine/`.
4. **The media never leaves the device.** No network requests carrying media, audio, transcripts or user data. The only allowed network traffic is downloading model files (from the Hugging Face CDN through Transformers.js). No analytics, no telemetry.
5. **No cross-origin isolation.** Don't set `Cross-Origin-Embedder-Policy` or `Cross-Origin-Opener-Policy` and don't rely on `SharedArrayBuffer`; the real site can't use them because they'd block its ads. So:
   - WebGPU is the fast path.
   - The WASM fallback runs single-threaded (set the ONNX Runtime WASM thread count to 1).
   - The engine must work with `self.crossOriginIsolated === false`.
6. **Free, permissive licences only** (MIT, Apache-2.0, BSD), installed from npm and bundled. Whisper's weights are MIT. Don't add paid or "non-commercial" models.
7. **The environment is Windows 11 inside a OneDrive folder.** File locks happen. If `node_modules` gets into a bad state, stop any dev server, delete `engine/node_modules` and run `npm ci` again.

## Tech stack

- TypeScript (strict), Vite for the demo page, Vitest for unit tests.
  - `erasableSyntaxOnly`: no enums and no constructor parameter properties.
  - Also turn on `noUnusedLocals` and `noUnusedParameters`.
- **`@huggingface/transformers`** (Transformers.js v3 or newer) for Whisper, run inside a **module Web Worker**.
- **`mediabunny`** to demux the file and decode its audio track in the browser via WebCodecs. Mediabunny reads the file in pieces, so long videos don't need to fit in memory at once.
  - Fallback for formats or browsers it can't handle: `AudioContext.decodeAudioData` on the file's bytes. Warn that this loads the whole file into memory, and cap it at about 200 MB with a clear error above that.
- Resample to **16 kHz mono Float32**, which is what Whisper expects. Use an `OfflineAudioContext`, or a small, well-tested linear resampler if that streams better; pick one and explain why.

## Models

Support three sizes and default to **base**:

| Name | Purpose |
|---|---|
| `tiny` | fastest, weakest; for slow machines |
| `base` | default; good balance |
| `small` | best quality; slow on integrated GPUs |

- Use **multilingual** Whisper (not `.en`), because Hindi and Hinglish creators are a key audience.
- Allow `language: 'auto' | 'en' | 'hi' | …` plus `task: 'transcribe'`. Translation isn't needed.
- **Word-level timestamps** need ONNX exports that include cross-attention outputs. In the Transformers.js ecosystem these are the `onnx-community/whisper-*_timestamped` models.
  - Verify the exact model ids work with `return_timestamps: 'word'`.
  - Put the ids in one config object, so they're easy to swap.
  - If a size has no word-timestamp export, fall back to segment timestamps for that size, mark the result `granularity: 'segment'`, and say so in your report.
- Choose `dtype` per device:
  - WebGPU: try `fp16`, falling back to `fp32` when the GPU lacks `shader-f16`.
  - WASM: `q8`.
- Report what you chose.

## Public API

Expose a small, framework-free API from `engine/src/index.ts`. React isn't needed, so the real site can wrap it later.

```ts
export type ModelSize = 'tiny' | 'base' | 'small'
export type Device = 'auto' | 'webgpu' | 'wasm'

export interface TranscriberOptions {
  model?: ModelSize            // default 'base'
  device?: Device              // default 'auto' → WebGPU if available, else WASM
}

export interface TranscribeOptions {
  language?: string            // 'auto' (default) or an ISO code like 'en', 'hi'
  signal?: AbortSignal         // cancels the run
  onProgress?: (p: Progress) => void
}

export type Progress =
  | { stage: 'download'; file: string; loaded: number; total: number }  // model files
  | { stage: 'load' }                                                   // model compiling / warming up
  | { stage: 'decode'; seconds: number; duration: number }              // audio extraction
  | { stage: 'transcribe'; seconds: number; duration: number }          // speech recognition

export interface Word {
  text: string                 // trimmed, no leading space
  start: number                // seconds from the start of the media
  end: number
}

export interface Segment {
  text: string
  start: number
  end: number
  words: Word[]
}

export interface Transcript {
  language: string             // detected or requested
  duration: number             // media duration in seconds
  granularity: 'word' | 'segment'
  segments: Segment[]
  words: Word[]                // flat list, sorted, no overlaps
  stats: {
    model: ModelSize
    device: 'webgpu' | 'wasm'
    dtype: string
    loadMs: number
    decodeMs: number
    transcribeMs: number
    realTimeFactor: number     // media seconds processed per wall-clock second
  }
}

export interface Transcriber {
  load(onProgress?: (p: Progress) => void): Promise<void>     // optional pre-warm
  transcribe(file: Blob, options?: TranscribeOptions): Promise<Transcript>
  dispose(): void                                             // terminates the worker, frees memory
}

export function createTranscriber(options?: TranscriberOptions): Transcriber
export function detectCapabilities(): Promise<{
  webgpu: boolean
  shaderF16: boolean
  webcodecsAudio: boolean
  recommendedModel: ModelSize
  recommendedDevice: 'webgpu' | 'wasm'
}>
```

### Behaviour requirements

- **Keep the page responsive.** All decoding-heavy and model work runs in the worker, so the page never freezes. Use plain `postMessage` with a typed message protocol in `engine/src/protocol.ts`, or Comlink (MIT) if you prefer; say which.
- **Long media.**
  - Process audio in **30-second windows with ~5-second overlap**.
  - Merge the overlaps so no word is duplicated or dropped at a window boundary.
  - Offset every timestamp to absolute media time.
  - It must handle a **60-minute** file without running out of memory: don't hold the whole decoded PCM plus every intermediate copy at once, and release buffers as you go.
- **Progress** updates arrive at least every ~500 ms during long stages, and progress never goes backwards.
- **Cancellation.**
  - `signal.abort()` stops work within ~1 second.
  - It rejects with an `AbortError`.
  - The transcriber stays usable afterwards; it's fine to restart the worker internally.
- **Model caching.** The second run must not re-download the model. Rely on Transformers.js's browser cache, verify it works, and document how to clear it.
- **Device fallback.** If the WebGPU adapter request or the WebGPU session creation fails, retry once on WASM automatically and report the device actually used.
- **Clean words.**
  - Trim whitespace and merge leading-space tokens.
  - Drop empty words and Whisper's non-speech artefacts like `[BLANK_AUDIO]`, `[Music]` and `(applause)`.
  - Clamp timestamps to `[0, duration]`.
  - Guarantee `start <= end` and that the words are sorted.
- **Errors.** Throw typed errors (`UnsupportedFormatError`, `NoAudioTrackError`, `ModelLoadError`, `OutOfMemoryError`) with messages a non-technical user can understand.

## Folder layout

```
engine/
  package.json            own deps and scripts
  package-lock.json
  tsconfig.json
  vite.config.ts          demo page (port 5180, so it doesn't clash with the website on 5173)
  vitest.config.ts
  README.md               how to run, API docs, model and cache notes, known limits
  src/
    index.ts              public API (createTranscriber, detectCapabilities, types)
    types.ts
    protocol.ts           worker message types
    capabilities.ts
    audio/
      decode.ts           mediabunny demux + decode, with the decodeAudioData fallback
      resample.ts         → 16 kHz mono Float32
    whisper/
      worker.ts           module worker: loads the pipeline, runs windows, posts progress
      models.ts           model ids, dtypes, per-device config
      windows.ts          pure: split into overlapping windows
      merge.ts            pure: merge window results, offset timestamps, de-duplicate
      clean.ts            pure: word cleanup rules
    errors.ts
  demo/
    index.html
    main.ts               demo UI (plain TS + minimal CSS, no framework)
  test/
    windows.test.ts
    merge.test.ts
    clean.test.ts
    resample.test.ts
```

## Demo page (`npm --prefix engine run dev`, http://localhost:5180)

A simple, clean page for testing. Plain HTML/CSS is fine; use a dark violet background (`#120b24`) and white text so it matches Offcut.

- Show `detectCapabilities()` results at the top: WebGPU yes/no, f16 yes/no, recommended model and device.
- Pickers for model (tiny/base/small), device (auto/webgpu/wasm) and language (auto/en/hi).
- File input plus a drag-and-drop zone. The chosen video plays in a `<video>` element.
- **Transcribe** and **Cancel** buttons. Progress shows the stage, a percentage and the elapsed time.
- **The transcript view:**
  - Words appear as clickable chips; clicking one seeks the video to that word.
  - While the video plays, the current word is highlighted. This proves the timestamps are right.
- A stats panel showing every field of `stats`.
- **Download JSON**, which saves the `Transcript` as a file the user keeps; nothing is uploaded.
- A **Clear model cache** button.

## Tests (`npm --prefix engine test`)

Unit-test the pure logic. Don't download models in tests.

- **windows:** correct 30 s / 5 s-overlap windows for 0 s, 12 s, 30 s, 31 s and 3,600 s inputs; the last window is handled.
- **merge:**
  - Words in an overlap appear once.
  - Words aren't lost at a boundary.
  - Absolute offsets are correct.
  - Output is sorted with no overlapping words.
  - Segment-granularity results still merge.
- **clean:** artefact tokens are removed, leading-space tokens are merged, timestamps are clamped, and empty strings are dropped.
- **resample:** 48 kHz stereo → 16 kHz mono preserves duration within one sample, and a known sine frequency survives.

Also add `npm --prefix engine run typecheck` and `npm --prefix engine run build` (a library build to `engine/dist` plus the demo build). Both must pass.

## Manual verification (do this and report the numbers)

1. Run the demo in Chrome on this machine. It's a Windows 11 laptop with Intel UHD Graphics (Gen 12, WebGPU available, `shader-f16` supported) and 15 GB RAM.
2. With a short clip with clear English speech (record one with the laptop if needed; don't commit it):
   - Check that word highlighting lines up with the speech within ~0.3 s.
3. Check that a Hindi or Hinglish clip works with `language: 'auto'` and `'hi'`, if you can get or record one.
4. Measure the **real-time factor** for each combination:
   - model: tiny / base / small
   - device: WebGPU / WASM

   Include a ~10-minute file for at least base + WebGPU.
5. **Cancel mid-run, then run again:** it must work without reloading the page.
6. **Reload the page and run again:** confirm there's no model re-download (check the Network tab or the progress events).
7. **Try a 60-minute file** (any long podcast you have locally) with base + WebGPU. Report peak memory from Chrome's Task Manager, and confirm it finishes without crashing.

## What to report when done

- A file list.
- How to run the demo and the tests.
- The exact model ids, dtypes and devices you chose, and whether each size supports word timestamps.
- A results table: model × device → load time, real-time factor, and peak memory (where measured).
- Accuracy notes for English and Hindi.
- Known limits (formats that fail, very long files, browser support).
- **Every place you deviated from this spec, and why.** Don't silently change the API; if something is impossible, say so instead of improvising.
