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
  onProgress: (progress) => console.log(progress),
});

transcriber.dispose();
```

`createTranscriber()` defaults to `model: "base"` and `device: "auto"`. Auto chooses WebGPU when an adapter is available, otherwise WASM. A requested WebGPU session that fails during model creation is retried once with WASM.

Cancellation uses `AbortSignal`. The public implementation terminates and recreates the worker immediately when the signal aborts, rejecting all in-flight pending requests with `AbortError` so no orphaned promises linger. The next run loads from the browser cache rather than reusing a half-cancelled session. `dispose()` is safe to call multiple times, and calling `load()` or `transcribe()` after disposal rejects cleanly.

## Audio pipeline and fallback

1. `mediabunny` reads the local `Blob` in chunks and uses WebCodecs-backed audio decoding when the container and codec are supported (`input.canRead()` and `track.canDecode()`).
2. Each inference window is 30 seconds with a 5-second overlap.
3. Downsampling uses an anti-aliasing windowed-sinc FIR low-pass filter (Blackman window, 65 taps, cutoff $0.45 \times \text{targetRate} = 7.2\text{ kHz}$) before linear interpolation. This prevents frequencies above 8 kHz from aliasing back into the speech band when downsampling 48 kHz or 44.1 kHz to 16 kHz.
4. **Main-thread decoding fallback:** if Mediabunny cannot read the container, the primary audio track cannot be decoded, or duration is invalid, the worker posts a `needs-fallback-decode` message to the main thread.
   - For files up to 200 MB, the main thread decodes the file using `OfflineAudioContext(1, 1, 16000).decodeAudioData(...)`.
   - Web Audio automatically resamples to 16 kHz during decode; the channels are downmixed to mono via `downmixToMono`.
   - The resulting `Float32Array` PCM buffer is transferred (zero-copy) back to the worker via a `transcribe-pcm` message and processed through a PCM window provider.
   - Files exceeding 200 MB that require fallback decoding throw `OutOfMemoryError` with a friendly conversion suggestion.

## Language detection

When `language: "auto"` is specified, the engine detects language on-device instead of defaulting to English:
1. It selects the first window with audio RMS $\ge 0.01$ (checking up to the first 3 windows, falling back to window 0).
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

## Stats definitions

`transcript.stats` reports:
- `loadMs`: model compilation and warmup duration (0 ms if already warm).
- `decodeMs`: cumulative time spent demuxing and decoding audio across all windows.
- `transcribeMs`: cumulative time spent running Whisper inference plus initial language detection.
- `realTimeFactor`: media duration in seconds divided by total wall-clock processing time (excluding initial model load), representing media seconds processed per second of wall time.

## Models and runtime choices

These are multilingual Whisper ONNX exports from the `onnx-community` Hugging Face namespace:

| Size | Model id | Word timestamp export | WebGPU dtype | WASM dtype |
| --- | --- | --- | --- | --- |
| tiny | `onnx-community/whisper-tiny_timestamped` | yes; runtime falls back to segment granularity if chunks lack word timestamps | `fp16` when shader-f16 is available, otherwise `fp32` | `q8` |
| base | `onnx-community/whisper-base_timestamped` | yes; runtime falls back to segment granularity if chunks lack word timestamps | `fp16` when shader-f16 is available, otherwise `fp32` | `q8` |
| small | `onnx-community/whisper-small_timestamped` | yes; runtime falls back to segment granularity if chunks lack word timestamps | `fp16` when shader-f16 is available, otherwise `fp32` | `q8` |

The ids are kept in one object at `src/whisper/models.ts`. The worker passes `return_timestamps: "word"` for these exports. If a model/browser combination returns no usable word chunks, the result is marked `granularity: "segment"` and approximate words are distributed inside each segment instead of pretending that the timestamps are exact.

Transformers.js is configured with browser caching enabled and remote models enabled. Raw media is passed to the pipeline as a local `Float32Array`; the model loader is the only code path that fetches from the network.

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

## Known limits

- Model downloads are large, especially `base` and `small`; the first run can take time and needs sufficient browser storage.
- The main path depends on the browser's WebCodecs audio support through Mediabunny. The fallback decoder is whole-file and capped at about 200 MB.
- WASM is intentionally single-threaded because Offcut cannot use cross-origin isolation. It is much slower than WebGPU on long recordings.
- Segment-granularity fallback words are approximate within their segment; the transcript explicitly reports `granularity: "segment"`.
- Browser GPU memory, device drivers, and model cache eviction vary. Benchmark real production hardware before choosing a default model for very long files.

## License note

`@huggingface/transformers` is Apache-2.0 and the configured Whisper model repositories are open ONNX exports. The required `mediabunny` package is MPL-2.0, not one of the MIT/Apache-2.0/BSD licenses listed in the brief. It is used because the brief also explicitly requires Mediabunny for demuxing/WebCodecs audio. This is the one deliberate licensing deviation and should be reviewed before publishing the engine as a distributable package.
