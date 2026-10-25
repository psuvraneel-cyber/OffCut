# Engine Round 1 prompt (for Gemini in Antigravity)

Copy everything below the line into Gemini.

---

## Who you are and what this is

You are a senior web engineer specialising in in-browser speech AI. You're improving an existing, working TypeScript module. **Don't rewrite it.** Make focused changes, in the order given, in the existing code style.

**The project:** Offcut is a free, open-source, in-browser AI video clipper. Long videos go in; captioned vertical clips come out. **Everything runs on the user's device**: "your video never leaves your computer" is the main promise. The budget is zero.

**The module:** `C:\OffCut\engine` is the transcription engine (Whisper in the browser). It was built from `docs/engine-transcription-prompt.md`, then fixed in a first pass. A reviewer (Claude) tested it and will verify your work afterwards, so **report honestly**, including what you didn't do or couldn't verify.

**This round's goal: stop the engine from skipping speech, and prove it with numbers.**

The project root is `C:\OffCut`. All paths below are relative to it.

## Read these first, in order

1. `HANDOFF.md`
2. `docs/engine-transcription-prompt.md`: the original spec. Its public API, behaviour rules and hard rules still apply, except where this prompt explicitly approves a change.
3. Every file in `engine/src/`, `engine/test/`, `engine/demo/main.ts`, `engine/manual-run.ts`, `engine/README.md`, `engine/package.json`, `engine/vite.config.ts`, `engine/tsconfig.json`.
4. `asr-evaluation-assets/README.md` and `asr-evaluation-assets/manifest.json`: the test set.

## Hard rules (breaking any of these fails the task)

1. **Engine code changes go only in `engine/`.**
   - Never touch `web/`, `functions/`, `shared/`, `migrations/`, the root `test/`, `docs/`, `HANDOFF.md`, the root `package.json`, the root lockfile, `wrangler.toml` or `.gitignore`.
2. **The test set is read-only.**
   - Never modify, move, rename, re-encode or delete anything that already exists in `asr-evaluation-assets/`.
   - You may create **new** files only in `asr-evaluation-assets/derived/` and `asr-evaluation-assets/results/`.
   - **Never copy any test-set audio, transcript or transcription result into `engine/`** or anywhere else git tracks. The whole `asr-evaluation-assets/` folder is git-ignored on purpose: it contains copyrighted NPR material, research-only SpokenCorpus clips and non-commercial CoSHE-500 clips.
3. **No git commands that change anything.** That means no commit, add, stash, checkout, reset or branch. `git status` and `git diff` are fine. Claude commits after verifying.
4. **Never run the root `npm run build`.** Run npm commands from inside `engine/` or with `--prefix engine`.
5. **No new npm dependencies.** Everything below can be done with `@huggingface/transformers` 3.8.1 (already installed) and plain TypeScript. Don't upgrade Transformers.js in this round.
6. **Never edit `engine/node_modules/`.**
7. **Privacy:**
   - No network requests carrying media, audio or transcripts to anything except the local dev server.
   - Model files may download only from Hugging Face, through Transformers.js.
   - No analytics.
8. **No cross-origin isolation:** no COOP/COEP headers and no `SharedArrayBuffer`. The ONNX WASM thread count stays at 1.
9. **Public API:** nothing may be removed or renamed in `engine/src/types.ts` or in the exports of `engine/src/index.ts`. **These additions only are approved, and all must be optional:**
   - `TranscribeOptions.vad?: boolean`. Default `true`; `false` gives exactly today's fixed-window behaviour.
   - `Transcript.stats` new optional fields: `vad?: "silero" | "off" | "failed"`, `vadMs?: number`, `speechSeconds?: number`, `windows?: number`, `retriedWindows?: number`.
10. **Don't guess library APIs.** Before using a Transformers.js API in a new way, read its source in `engine/node_modules/@huggingface/transformers/src/` and cite file and line numbers in your report. If something doesn't exist, say so.
11. **Code style:**
    - TypeScript strict, `erasableSyntaxOnly` (no `enum`, no constructor parameter properties), `noUnusedLocals`, `noUnusedParameters`.
    - Double quotes, 2-space indent, `#private` fields, small pure functions, sparse comments.
    - Put every tunable number in one exported constants object per file, so it's easy to find.
12. **Don't tune thresholds until the test set scores perfectly.** There are only 11 samples, so over-fitting is easy. Use the starting values given here unless a measurement clearly shows they're wrong, and report every change with the before and after numbers.
13. **Ask the owner once, at the start, before downloading the `base` model** (about 140 MB). `tiny` and the Silero VAD model (about 2 MB) are approved. Don't download `small` or larger models.
14. **Run Chrome visibly** (not minimised or headless-throttled) for every timing measurement. Background tabs throttle timers and slow the GPU.

## Facts you can rely on (already verified by the reviewer)

**The engine today:**

- Every file is decoded with Mediabunny in the worker, resampled to 16 kHz (with an anti-alias FIR filter), cut into **fixed 30 s windows with 5 s overlap** (`engine/src/whisper/windows.ts`) and transcribed one window at a time.
- The windows are merged with a **cut-point merge** (`engine/src/whisper/merge.ts`): for overlapping windows A and B it keeps A's words whose midpoint is before `(B.start + A.end) / 2`, and B's words from there on. This also works when windows don't overlap: the cut then falls in the gap.
- Language `"auto"` is detected once from the first window with RMS ≥ 0.01 (`engine/src/whisper/language.ts`).

**Known problem (the target of this round):** Whisper sometimes returns only a few words for a 30 s window full of speech. On `engine/manual-english-10m.wav` (one 10.8 s sentence looped about 55 times):

- `tiny` on WebGPU output 999 words where about 1,270 are spoken. Whole stretches came back nearly empty: 173–205 s, 249–300 s and 509–520 s.
- Transcribing the 250–280 s stretch alone also returns only 6 of about 60 words. So it's the model, not the merge.
- That file is a worst case, because Whisper suppresses text that looks repeated. Real speech must be measured separately, which is why the benchmark comes first.

**Other measured facts:**

- Windows are 1–2 samples longer than 30 s (480,001 or 480,002 samples). That triggers the Transformers.js console warning "Attempting to extract features for audio longer than 30 seconds". Harmless, but the new windows must be at most 480,000 samples.
- In the 10-minute test, decoding took about 1.8 s and recognition about 79 s. Whisper is about 98% of the time.

**Test set** (`asr-evaluation-assets/manifest.json` has every path):

| Sample IDs | What | Length | Reference transcript notes |
|---|---|---|---|
| `EN_PODCAST_001` | NPR Planet Money, segment 0–101 s, 6 speakers, sound effects, Chinese-language clips | 101 s | `reference.txt` has speaker labels like `KEITH ROMER:`, cues like `[COIN SPINNING]` and `[SPEAKING CHINESE]`, and `--` for cut-off words |
| Full episode (no ID yet) | `01_english_podcast/audio/original/EN_PODCAST_001_full_episode.mp3` | 1,704.6 s (28.4 min) | The full published transcript is **line 3** of `01_english_podcast/transcripts/source_transcript.txt`: one 28,417-character line, turns run together with no spaces (`…from NPR.[COIN SPINNING]KEITH ROMER: Over…`), ending `…Thanks for listening.[MUSIC PLAYING]`. The rest of that file is scrape debris (repeated, truncated copies), so ignore it. The audio may contain ads that aren't in the transcript. |
| `HI_INDIC_001`–`003` | Hindi (Devanagari), IndicVoices | 4.5–5.3 s each | Verbatim Devanagari |
| `HINGLISH_COSHE_001`–`003` | Hinglish, CoSHE-500 | 19–28 s each | Mixed script: Hindi in Devanagari, English in Latin |
| `VLOG_DRIVE_001`–`004` | Driving vlog clips, SpokenCorpus | 1.1–6.6 s each | Tokenised text: `So I 'm literally … you guys .` (space before contractions and full stops) |

Caveats about the test set:

- The manifest marks samples `AUDIO_LISTENED` and `TRANSCRIPT_HUMAN_VERIFIED`, but no human checked them. Treat the references as **source transcripts, not proven ground truth**. If a reference looks wrong against the audio, report it; don't edit it.
- Use the 16 kHz files in `audio/standardized/` for the short samples. For the full episode, use the original MP3, which also exercises the real Mediabunny decode path.

**Silero VAD** (voice activity detection: a small model that finds where people are speaking; MIT licence):

- On Hugging Face as `onnx-community/silero-vad`. Files include `onnx/model.onnx` (fp32), plus fp16 and quantized variants. Use fp32 on WASM.
- Official wrapper (`snakers4/silero-vad`, `src/silero_vad/utils_vad.py`, `OnnxWrapper.__call__`), at 16 kHz:
  - It feeds **512-sample frames** (32 ms).
  - It **prepends the previous 64 samples of context** to each frame, so the model input is `[1, 576]`. The first frame's context is zeros.
  - Inputs are `input` (float32), `state` (float32 `[2, 1, 128]`, zeros at start, replaced by the returned state every frame) and `sr` (int64 scalar 16000).
  - Outputs are the speech probability and the new state.
- Official `get_speech_timestamps` defaults: `threshold 0.5`, `neg_threshold = max(threshold - 0.15, 0.01)`, `min_speech_duration_ms 250`, `min_silence_duration_ms 100`, `speech_pad_ms 30`.
- **Verify the onnx-community export's real input names and shapes** before relying on any of this. Read `README.md` in the Hugging Face repo and inspect the loaded session's input metadata. Then load it via Transformers.js. Check `AutoModel.from_pretrained` with a custom `model_type` in `models.js`, or use the ONNX Runtime session Transformers.js already bundles. Cite what you used.

## Part A: the benchmark (do this first, before changing any engine behaviour)

**A1. Scoring code** in `engine/bench/wer.ts`: pure functions, unit-tested in `engine/test/wer.test.ts`.

**`normalizeForScoring(text)`** applies the same steps to references and to engine output:

1. Unicode NFC.
2. Remove bracketed cues: `[…]` and `(…)`.
3. Remove speaker labels: an all-caps name of 1–4 words followed by `:`. These appear at the start of a line **and** run-on mid-line right after `.`, `!`, `?`, `]` or a quote with no space, as in `NPR.[COIN SPINNING]KEITH ROMER: Over`. Don't strip ordinary words: use only uppercase Latin letters, spaces, `.`, `'` and `-` in the name.
4. Re-join split contractions: `I 'm` → `I'm`, `you 're` → `you're`.
5. Lower-case. This only affects Latin letters.
6. Turn `--`, `—`, `–` and `-` into spaces.
7. Delete all other punctuation, including the Devanagari `।` and `॥`, but keep `'` inside words, digits and `%`.
8. Collapse whitespace.

Don't convert numbers to words. Report number-format mismatches instead.

**Error measures:**

- **`wordErrors(reference, hypothesis)`**: word-level Levenshtein distance. It returns `{ substitutions, deletions, insertions, referenceWords, wer }`.
- **`charErrors(…)`**: the same over Unicode code points with spaces removed. This gives the CER (character error rate), which is more meaningful for Hindi spellings.

**Unit tests** must use exactly the run-on NPR string and the tokenised vlog string shown above, a Devanagari sentence with `।`, and mixed-script text.

**A2. Long reference.** Write a small Node script, `engine/bench/make-references.mjs`, that:

- extracts line 3 of the NPR `source_transcript.txt`;
- checks that it starts with `ANNOUNCER: This is Planet Money from NPR.` and contains `Thanks for listening.`;
- writes it unchanged to `asr-evaluation-assets/derived/EN_PODCAST_FULL_reference.txt`;
- prints the first 300 characters after normalisation, so you can eyeball that the speaker labels are gone.

Run it once.

**A3. Benchmark page** (dev only): `engine/bench/index.html` plus `engine/bench/main.ts`.

- Add a dev-only Vite plugin in `engine/vite.config.ts` (`apply: "serve"`). It:
  - serves `GET /eval/*` from `../asr-evaluation-assets/*`, rejecting any path that escapes that folder;
  - accepts `POST /eval-results/<name>.json`, writing only into `../asr-evaluation-assets/results/`, with a safe file name.

  Neither may appear in the production build. Leave the build `input` list without the bench page.
- The page reads `/eval/manifest.json` plus the long reference. It runs the engine on every sample and shows a table.
- URL parameters:
  - `?model=tiny|base`
  - `&device=webgpu|wasm`
  - `&vad=on|off`
  - `&set=short|long|all`
  - `&runs=N`
  - `&label=<text>`

  Short = the 10 clips plus `EN_PODCAST_001`. Long = the full episode, `engine/manual-english-10m.wav`, and two **stitched** files built in memory at runtime:
  - `STITCH_HINGLISH`: the 3 CoSHE clips joined with 1.5 s of silence, with their references joined in the same order;
  - `STITCH_SILENCE`: 10 s of digital silence, then `VLOG_DRIVE_003`, then 10 s of silence. This tests hallucination on silence.

  Never write stitched audio to disk.
- **Language per sample:**
  - English samples use `en`.
  - Hindi uses both `auto` and `hi`.
  - Hinglish uses both `auto` and `hi`.
  - For the 10-minute loop file, use `en`.
- **For every sample and run, record:**
  - WER with S/D/I counts, and CER;
  - **deletion rate** (D ÷ reference words). This is the main "skipped speech" number;
  - the **longest gap** between consecutive output words that falls inside detected speech (with VAD on) or anywhere (with VAD off);
  - words output inside `STITCH_SILENCE`'s silent parts (should be 0);
  - detected language;
  - all `stats` fields and wall time.
- Show a summary per category, and expose the results as `window.__benchResults`.
- POST the full results (including the output text) to `/eval-results/<label>-<model>-<timestamp>.json`.
- Also write a **numbers-only** summary table (no transcript text) for each run to `engine/bench/RESULTS.md`. That file is the only bench output allowed in `engine/`.

**A4. Baseline.** With the engine still unchanged, run:

- `set=all`, `model=tiny`, `vad=off`, `runs=1`;
- `set=short`, `runs=3`, to see how much results vary between runs;
- the same two with `base`, if the owner approved the download.

Label these `baseline`. **Don't change engine behaviour until the baseline is saved.**

## Part B: cut at pauses with Silero VAD

**B1. VAD module:** `engine/src/whisper/vad.ts`.

- Load `onnx-community/silero-vad` once per worker, cached like the Whisper model. Run it on WASM.
- Run it over 16 kHz mono audio with the official frame and context behaviour above. Return one speech probability per 512-sample frame.
- Then turn probabilities into speech segments with a pure function, `probabilitiesToSegments(probs, constants)`. Starting constants:
  - `threshold 0.5`
  - `negThreshold 0.35`
  - `minSpeechMs 250`
  - `minSilenceMs 300`
  - `speechPadMs 200`
- Unit-test the pure function with synthetic probability arrays.

**B2. Two passes, with bounded memory:**

1. **Pass 1:** stream the whole file through the existing provider in consecutive, non-overlapping blocks of at most 30 s, keeping the VAD state between blocks. Keep **only the frame probabilities** (about 450 KB for 60 minutes), never the decoded audio. Report it as `decode` progress from 0 to `duration`.
2. **Pass 2:** plan windows from the speech segments, then decode and transcribe each window as today. Report it as `transcribe` progress.

This must work for both the Mediabunny provider and the PCM fallback provider. Measure `vadMs` separately, and count pass-1 decoding in `decodeMs`.

**B3. Window planner:** a pure function `planWindows(segments, probs, duration, constants)` in `engine/src/whisper/windows.ts`, with unit tests.

- Merge speech segments greedily into windows. A window's span (first speech start minus padding, up to last speech end plus padding) must be at most `maxWindowSeconds 28`.
- When the next segment would overflow, close the current window at the previous speech end plus `min(pad, gap / 2)` and open a new one.
- Silence between windows is **never transcribed**.
- Long silences *inside* a window are fine. Don't create tiny windows: Whisper's encoder always processes a full 30 s, so every window costs the same.
- **A single speech run longer than 28 s with no qualifying pause:**
  - split at the frame with the lowest speech probability between 20 s and 28 s into the window;
  - if no frame there is below `negThreshold`, hard-split at 28 s with a `forcedOverlapSeconds 2` overlap. The existing cut-point merge handles that boundary.
- Every window is at most 480,000 samples, so the >30 s warning disappears.
- **Short or empty files:**
  - if the file is under 5 s, or VAD finds less than 1 s of speech in total, use **one window over the whole file** (or the old fixed windows if the file is longer than 28 s);
  - never return an empty transcript because the VAD missed quiet speech.
- **Language detection** (`auto`) uses the first planned window, which contains speech by construction. Keep the RMS rule only for `vad: false`.

**B4. Fallback and option:**

- `vad: false` reproduces today's fixed 30 s / 5 s windows exactly, with `stats.vad: "off"`.
- If the VAD fails to load or run (for example offline with no cache), log one warning, fall back to the fixed windows, and set `stats.vad: "failed"`. **A VAD problem must never fail a transcription.**

**B5.** Bench again with label `vad`, using the same runs as the baseline.

## Part C: the safety net for windows Whisper still under-transcribes

**C1. Detector:** a pure function `assessWindow(result, speechSegmentsInWindow, constants)` in `engine/src/whisper/retry.ts`, with unit tests. It flags a window when, with starting constants:

- **Too few words:** speech in the window ≥ `minSpeechForCheckSeconds 5` and words < `minWordsPerSpeechSecond 0.8` × speech seconds.
- **Stopped early:** the last word ends more than `edgeGapSeconds 4` before the window's last speech end.
- **Started late:** the first word starts more than 4 s after the window's first speech start.
- **Repetition loop:** any 1–4-word sequence repeated 4 or more times in a row.

With `vad: false`, use per-frame RMS ≥ 0.01 as the speech estimate.

**C2. Retry:** for each flagged window, retry it **once**, split into two halves.

- Split at the lowest-probability frame nearest the middle, or at the middle with a 1 s overlap if there's no pause.
- Transcribe both halves and merge them with the existing cut-point merge.
- Use the retry only if it has more words in the flagged region **and** no repetition loop. Otherwise keep the original.
- Never retry a retry. Count retries in `stats.retriedWindows`. Retry time goes in `transcribeMs`.
- Progress must stay monotonic during retries: keep `seconds` at the window's end.

**C3.** Bench again with label `vad-retry`, using the same runs.

## Part D: checks and docs

1. `npm --prefix engine run typecheck`, `npm --prefix engine test` and `npm --prefix engine run build` all pass. All 29 existing tests still pass (update them only if behaviour intentionally changed, and say which). The new tests cover `wer`, `vad` segments, `planWindows`, `retry` and merging non-overlapping windows.
2. Confirm `git status` (run in `C:\OffCut`) shows **nothing** under `asr-evaluation-assets/`, and that `engine/bench/RESULTS.md` contains no transcript text.
3. Re-check in the demo (`npm --prefix engine run dev`): cancel then run again, reload with no model re-download, the fallback decoder still works, and `vad: false` matches the baseline's word output on `EN_PODCAST_001`.
4. Update `engine/README.md`: the VAD, the two passes, window planning, the retry, the new options and stats, and how to run the benchmark. Point out that test-set results stay local.

## Targets (what success looks like; report honestly if you miss them)

- **Deletion rate** on the full NPR episode and the 10-minute loop drops clearly against the baseline, and none of the long gaps listed above remain on the loop file.
- **WER** on the short set doesn't get worse by more than 2 points absolute in any category.
- **0 words** in `STITCH_SILENCE`'s silent parts.
- **Total wall time** on the full episode rises by no more than 10% over the baseline. Skipping silence may make it faster.

## What to report when done

- Every file added or changed, with a one-line reason each.
- **Results table:** baseline vs `vad` vs `vad-retry`, per category and model. Include WER, CER, deletion rate, longest gap, words in silence, wall time, real-time factor, `vadMs`, windows and retries. Include the run-to-run spread from `runs=3`.
- The VAD input names and shapes you actually found, and the Transformers.js source you relied on (file and line numbers).
- Every threshold you changed from its starting value, with before and after numbers.
- Reference transcripts that look wrong against the audio, if any.
- Every deviation from this prompt and why, everything you couldn't verify, and anything you noticed but didn't fix.
