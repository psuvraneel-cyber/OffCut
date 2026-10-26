# Offcut transcription engine

Standalone, framework-free, on-device Whisper transcription for Offcut. The browser receives a local `Blob`, demuxes/decodes audio in a module worker, resamples it to 16 kHz mono, runs Whisper in that same worker, and returns timestamped words. The media and transcript never go to a server.

## Run the demo

From the repository root:

```powershell
npm install --prefix engine
npm --prefix engine run dev
```

Open [http://localhost:5180](http://localhost:5180). Choose an audio/video file, select a model and device, then press **Transcribe**. The preview uses the local object URL only; it is never uploaded.

The demo includes:

- WebGPU, shader-f16 and WebCodecs capability reporting
- model, device and language pickers
- file input and drag-and-drop
- responsive progress, cancellation, and typed error messages
- clickable words that seek the local video
- current-word highlighting during playback
- JSON download and a Transformers.js cache-clear button

## Checks

```powershell
npm --prefix engine run typecheck
npm --prefix engine test
npm --prefix engine run build
```

`build` emits both the demo and a library entry under `engine/dist/`. The root project is intentionally not involved in these commands.

## Public API

```ts
import { createTranscriber, detectCapabilities } from "./src/index";

const capabilities = await detectCapabilities();
const transcriber = createTranscriber({ model: "base", device: "auto" });

const transcript = await transcriber.transcribe(file, {
  language: "auto",
  vad: true, // defaults to true; set false for fixed 30s/5s windows
  onProgress: (progress) => console.log(progress),
});

transcriber.dispose();
```

`createTranscriber()` defaults to `model: "base"` and `device: "auto"`. Auto chooses WebGPU when an adapter is available, otherwise WASM. A requested WebGPU session that fails during model creation is retried once with WASM.

Cancellation uses `AbortSignal`. The public implementation terminates and recreates the worker immediately when the signal aborts, rejecting all in-flight pending requests with `AbortError` so no orphaned promises linger. The next run loads from the browser cache rather than reusing a half-cancelled session. `dispose()` is safe to call multiple times, and calling `load()` or `transcribe()` after disposal rejects cleanly.

## Two-Pass Architecture and Silero VAD

Whisper's attention mechanism easily skips speech or hallucinates repetitively when 30-second fixed windows cut through words or contain long stretches of silence. The engine uses a two-pass pipeline powered by Silero VAD (`onnx-community/silero-vad` running on single-threaded WASM):

1. **Pass 1 — Streaming VAD with Bounded Memory:**
   - The audio provider streams consecutive, non-overlapping blocks of at most 30 seconds.
   - Silero VAD processes 16 kHz mono audio in 512-sample frames with persistent 64-sample context and hidden state tensors across blocks.
   - Decoded audio is immediately garbage-collected after each block. Only the resulting frame speech probabilities are retained (~450 KB for a 60-minute file).
   - Reports `decode` progress monotonically from 0 to `duration`.
   - If VAD fails to load or run, the engine logs a single warning, sets `stats.vad: "failed"`, and transparently falls back to fixed windows. A VAD issue never fails transcription.

2. **Window Planning (`planWindows`):**
   - Pure function `probabilitiesToSegments` converts probabilities into padded speech segments (`threshold: 0.5`, `negThreshold: 0.35`, `minSpeechMs: 250`, `minSilenceMs: 300`, `speechPadMs: 200`).
   - `planWindows` greedily aggregates speech segments into windows bounded strictly to $\le 28\text{ s}$ ($\le 448,000$ samples), completely eliminating Whisper's $>30\text{ s}$ audio warning.
   - Silence between windows is never fed to Whisper, eliminating silence hallucinations.
   - Continuous speech runs $>28\text{ s}$ with no pause are split at the lowest-probability frame between 20 s and 28 s, or hard-split at 28 s with a 2-second forced overlap.
   - Short files (<5 s) or files with <1 s total speech fall back to a single window or fixed windows so quiet speech is never missed.

3. **Pass 2 — Transcribe & Retry Safety Net:**
   - Decodes and transcribes only the planned speech windows.
   - Reports `transcribe` progress monotonically from 0 to `duration`.
   - `language: "auto"` detects language using the first planned window, which contains speech by construction.

## The Retry Safety Net

Even with pause-based windowing, Whisper can occasionally drop speech or get stuck in autoregressive loops. Each window's output is evaluated by `assessWindow`:

- **Too few words:** $\ge 5\text{ s}$ of speech in the window but $<0.8\text{ words/speech second}$.
- **Stopped early:** last word ends $>4\text{ s}$ before speech ends in the window.
- **Started late:** first word starts $>4\text{ s}$ after speech begins in the window.
- **Repetition loop:** any 1–4-word phrase repeated 4 or more times consecutively.
- **VAD-off fallback:** when `vad: false`, speech presence is estimated using per-frame audio loudness (RMS $\ge 0.01$).

When a window is flagged, it is retried **once** by splitting into two halves:
- Split at the lowest-probability frame near the middle (or midpoint with 1 s overlap if unpaused).
- Both halves are transcribed and merged using cut-point merging.
- The retry is accepted only if it contains more words within the flagged region than the original window, or if it breaks a repetition loop. Otherwise, the original transcript is preserved.
- Monotonic progress is maintained (`seconds` stays clamped to the window end).

## Audio pipeline and fallback

1. `mediabunny` reads the local `Blob` in chunks and uses WebCodecs-backed audio decoding when the container and codec are supported (`input.canRead()` and `track.canDecode()`).
2. Downsampling uses an anti-aliasing windowed-sinc FIR low-pass filter (Blackman window, 65 taps, cutoff $0.45 \times \text{targetRate} = 7.2\text{ kHz}$) before linear interpolation. This prevents frequencies above 8 kHz from aliasing back into the speech band when downsampling 48 kHz or 44.1 kHz to 16 kHz.
3. **Main-thread decoding fallback:** if Mediabunny cannot read the container, the primary audio track cannot be decoded, or duration is invalid, the worker posts a `needs-fallback-decode` message to the main thread.
   - For files up to 200 MB, the main thread decodes the file using `OfflineAudioContext(1, 1, 16000).decodeAudioData(...)`.
   - Web Audio automatically resamples to 16 kHz during decode; the channels are downmixed to mono via `downmixToMono`.
   - The resulting `Float32Array` PCM buffer is transferred (zero-copy) back to the worker via a `transcribe-pcm` message and processed through a PCM window provider.
   - Files exceeding 200 MB that require fallback decoding throw `OutOfMemoryError` with a friendly conversion suggestion.

## Language detection

When `language: "auto"` is specified, the engine detects language on-device instead of defaulting to English:
1. With VAD enabled, it uses the first planned window (guaranteed to contain speech). With `vad: false`, it selects the first window with audio RMS $\ge 0.01$ (checking up to the first 3 windows).
2. It extracts log-mel filterbank features with Whisper's processor and performs a single decoder step using the `<|startoftranscript|>` token.
3. It evaluates logits restricted exclusively to Whisper's language token set (`lang_to_id`) to find the maximum-likelihood language code. If a direct forward pass is unavailable, it uses `model.generate` with `max_new_tokens: 1` as a fallback.
4. The detected ISO code is locked for the entire file so window captions never flip languages mid-stream, and the final `transcript.language` reflects the detected code (falling back to `"en"` if detection fails).

## Cut-point window merging

Overlapping inference windows are merged using a deterministic cut-point strategy:
- For consecutive windows A and B with overlap $[B.\text{start}, A.\text{end}]$, the cut point is $\text{cut} = (B.\text{start} + A.\text{end}) / 2$.
- Words or segments whose midpoint $(start + end) / 2$ is before $\text{cut}$ are retained from window A; those at or after $\text{cut}$ are retained from window B.
- This eliminates duplicate words across window boundaries, even when Whisper emits differing punctuation or casing in adjacent windows.
- Word boundaries are normalized so words are strictly sorted without overlaps ($word.\text{start} \ge previous.\text{end}$). Overlaps are resolved by trimming the previous word's end or splitting at the overlap midpoint.
- A minimum word duration of $0.08\text{ s}$ is enforced whenever adjacent neighbors leave room, ensuring zero-length Whisper artifacts expand to highlightable words during playback.
- Segments are rebuilt cleanly from the merged word stream using `groupWordsIntoSegments`.

## Captions

The engine exports pure helper functions to group word timestamps into readable subtitle cues and format them as standard SRT or WebVTT files:

- `buildCaptionCues(words, options?)`: groups an array of `Word` objects into `CaptionCue` items. Default options from `CAPTION_CONSTANTS`:
  - `maxCharsPerLine`: 32 characters per line (short lines for vertical mobile video).
  - `maxLines`: 2 lines per cue.
  - `maxCueSeconds`: 5 seconds maximum per cue.
  - `maxGapSeconds`: 1.0 second pause threshold before starting a new cue.
  - `minCueSeconds`: 0.7 seconds minimum display duration.
  - `includeSoundCues`: defaults to `false` (drops words with `kind: "cue"` like `(laughing)` unless set to `true`).
- `toSrt(cues)`: formats caption cues as an SubRip (`.srt`) string with `\r\n` line endings. Returns `""` when cues is empty.
- `toVtt(cues)`: formats caption cues as a WebVTT (`.vtt`) string with `\n` line endings and escaped characters (`&`, `<`, `>`, and `-->` converted to `→`). Returns `"WEBVTT\n"` when cues is empty.

## Stats definitions

`transcript.stats` reports:
- `model`: the selected model size (`tiny`, `base`, `small`).
- `device`: execution device (`webgpu` or `wasm`).
- `dtype`: precision (`fp16`, `fp32`, `q8`).
- `loadMs`: model compilation and warmup duration (0 ms if already warm).
- `decodeMs`: cumulative time spent demuxing and decoding audio across all windows.
- `transcribeMs`: cumulative time spent running Whisper inference, retries, and language detection.
- `realTimeFactor`: media duration in seconds divided by total wall-clock processing time (excluding initial model load), representing media seconds processed per second of wall time.
- `vad`: `"silero"`, `"off"`, or `"failed"`.
- `vadMs`: time spent running Silero VAD on WASM during Pass 1.
- `speechSeconds`: total seconds of detected speech in the recording.
- `windows`: total planned inference windows processed.
- `retriedWindows`: number of windows retried by the safety net.
- `speechSegments`: VAD speech regions in seconds, only present when `stats.vad` is `"silero"`.

## Benchmarks & Evaluation

An automated evaluation harness is included for regression and accuracy benchmarking against standardized reference datasets.

### Running the Benchmarks

1. Start the dev server:
   ```powershell
   npm --prefix engine run dev
   ```
2. Navigate to the benchmark page in Chrome:
   - Baseline (no VAD, fixed windows): `http://localhost:5180/bench/index.html?model=tiny&device=webgpu&vad=off&set=all&runs=1&label=baseline`
   - Silero VAD: `http://localhost:5180/bench/index.html?model=tiny&device=webgpu&vad=on&set=all&runs=1&label=vad`
   - Silero VAD + Retry: `http://localhost:5180/bench/index.html?model=tiny&device=webgpu&vad=on&set=all&runs=1&label=vad-retry`

URL options:
- `model`: `tiny` | `base` (default `tiny`)
- `device`: `webgpu` | `wasm` (default `webgpu` when available, otherwise `wasm`)
- `vad`: `on` | `off` (default `off`)
- `set`: `short` (11 clips, 17 evaluations) | `long` (full episode, 10m loop, stitched clips) | `all` (22 evaluations)
- `runs`: number of repetitions for variance testing (e.g. `3`)
- `label`: output prefix for results JSON

Results are automatically saved to `asr-evaluation-assets/results/<label>-<model>-<timestamp>.json` and appended as numbers-only summary tables to `engine/bench/RESULTS.md`.

> [!IMPORTANT]
> Evaluation media and reference transcripts located in `asr-evaluation-assets/` are local evaluation assets and are never committed to the git repository. Results files in `asr-evaluation-assets/results/` and derived files remain local.

## Models and runtime choices

These are multilingual Whisper ONNX exports from the `onnx-community` Hugging Face namespace:

| Size | Model id | Word timestamp export | WebGPU dtype | WASM dtype |
| --- | --- | --- | --- | --- |
| tiny | `onnx-community/whisper-tiny_timestamped` | yes; runtime falls back to segment granularity if chunks lack word timestamps | `fp16` when shader-f16 is available, otherwise `fp32` | `q8` |
| base | `onnx-community/whisper-base_timestamped` | yes; runtime falls back to segment granularity if chunks lack word timestamps | `fp16` when shader-f16 is available, otherwise `fp32` | `q8` |
| small | `onnx-community/whisper-small_timestamped` | yes; runtime falls back to segment granularity if chunks lack word timestamps | `fp16` when shader-f16 is available, otherwise `fp32` | `q8` |

The ids are kept in one object at `src/whisper/models.ts`. The worker passes `return_timestamps: "word"` for these exports. If a model/browser combination returns no usable word chunks, the result is marked `granularity: "segment"` and approximate words are distributed inside each segment instead of pretending that the timestamps are exact.

Transformers.js is configured with browser caching enabled and remote models enabled. Raw media is passed to the pipeline as a local `Float32Array`; the model loader is the only code path that fetches from the network.

"fp16" on WebGPU keeps the Whisper encoder in fp32 and only the decoder in fp16, because the fp16 encoder produces garbage on WebGPU. Each Whisper call is capped at 30 output tokens per second of audio (`GENERATION_CONSTANTS` in `src/whisper/models.ts`) so runaway output stops early.

ONNX Runtime's WebAssembly binary (`ort-wasm-simd-threaded.jsep.wasm`, 21.6 MB) is served from our own origin as a build asset (`src/whisper/ort-assets.ts`). Transformers.js would otherwise load it from cdn.jsdelivr.net. Model files are the only thing fetched from a third party (Hugging Face). `test/ort-assets.test.ts` checks that the file exists and that its `onnxruntime-web` version matches the one Transformers.js pins.

### Clearing the model cache

Transformers.js stores model files in the Cache Storage cache named `transformers-cache`. The demo's **Clear model cache** button deletes that cache. You can also remove it in Chrome DevTools → **Application** → **Storage** → **Cache Storage**. The next run will download the selected model again.

## Worker protocol

The engine uses plain typed `postMessage` rather than Comlink. `src/protocol.ts` defines load, transcribe, transcribe-pcm, cancel, dispose, progress, result, error, and needs-fallback-decode messages. This keeps the public package framework-free and lets the real site wrap it from React later.

The WASM backend is explicitly configured to one ONNX Runtime thread. No `SharedArrayBuffer`, COOP, or COEP is required; the engine is designed to run with `crossOriginIsolated === false`.

## Errors

The public worker reports these user-facing typed errors:

- `UnsupportedFormatError`: the browser cannot decode the selected format
- `NoAudioTrackError`: the file has no usable audio track
- `ModelLoadError`: model download/compile/session creation failed
- `OutOfMemoryError`: the whole-file fallback would exceed the 200 MB cap
- `AbortError`: the caller cancelled or disposed the run
- `GpuLostError`: the GPU device was lost (driver reset, too little GPU memory, or another tab took it). A lost WebGPU device can never be reused, so the engine terminates its worker and starts a fresh one. With `device: "auto"`, later runs use the CPU (WASM, q8) for the rest of the page's life; with `device: "webgpu"` they try the GPU again. Expect lower accuracy on the CPU fallback.

GPU memory is released in full only when the worker ends: ONNX Runtime keeps its own WebGPU device and frees its shared buffer cache only after every session, including Silero VAD's, is released. For tests, `loseGpuForTesting()` on the transcriber destroys the worker's GPU device; it isn't part of the `Transcriber` interface.

## Known limits

- Model downloads are large, especially `base` and `small`; the first run can take time and needs sufficient browser storage.
- The main path depends on the browser's WebCodecs audio support through Mediabunny. The fallback decoder is whole-file and capped at about 200 MB.
- WASM is intentionally single-threaded because Offcut cannot use cross-origin isolation. It is much slower than WebGPU on long recordings.
- Segment-granularity fallback words are approximate within their segment; the transcript explicitly reports `granularity: "segment"`.
- Browser GPU memory, device drivers, and model cache eviction vary. Benchmark real production hardware before choosing a default model for very long files.

## License note

`@huggingface/transformers` is Apache-2.0 and the configured Whisper model repositories are open ONNX exports. The required `mediabunny` package is MPL-2.0, not one of the MIT/Apache-2.0/BSD licenses listed in the brief. It is used because the brief also explicitly requires Mediabunny for demuxing/WebCodecs audio. This is the one deliberate licensing deviation and should be reviewed before publishing the engine as a distributable package.
