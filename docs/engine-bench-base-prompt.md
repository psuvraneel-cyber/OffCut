# Engine benchmark run: `base` vs `tiny` (prompt for Gemini in Antigravity)

Copy everything below the line into Gemini.

---

## Your job, in one sentence

Run four benchmark sessions of the Offcut transcription engine in Chrome, check them, and report the numbers. **This is a measurement task, not a coding task. You must not change any code.**

## Why this matters

Offcut is a free, open-source, in-browser AI video clipper. Its transcription engine (Whisper running in the browser) lives in `C:\OffCut\engine`. A bug that made the `base` model output garbage was just fixed. The owner needs trustworthy numbers for `base` against `tiny` on every test sample before deciding which model ships as the default. A reviewer (Claude) will check your report against the result files, so **report exactly what happened, including failures**. A wrong number is worse than a missing one.

The project root is `C:\OffCut`. All paths below are relative to it.

## Hard rules (breaking any of these fails the task)

1. **Do not edit, create, rename or delete any file** in the repository, with two exceptions that the benchmark page itself performs automatically:
   - it appends a section to `engine/bench/RESULTS.md` at the end of each run;
   - it writes one JSON file per run into `asr-evaluation-assets/results/`.
   That includes: no edits to `engine/src/`, `engine/test/`, `engine/bench/*.ts`, `engine/bench/*.html`, `engine/vite.config.ts`, any `package.json`, any lockfile, `.gitignore`, `docs/`, `HANDOFF.md`.
2. **Do not "fix" anything.** If something fails, crashes, looks wrong or doesn't match this prompt, **stop that run and report it** with the exact error text. Do not work around it, retry with changed settings, or edit code to make it pass. The previous round produced bugs exactly by doing this.
3. **No git commands that change anything** (no commit, add, stash, checkout, reset, restore, branch, merge, pull, push). `git status`, `git log` and `git diff` are fine.
4. **No npm installs or upgrades.** Don't run `npm install`, `npm ci` or `npm update` unless step 0.3 says `engine/node_modules` is missing. Never run the root `npm run build`.
5. **The test set is read-only.** Never modify, move, rename, re-encode or delete anything in `asr-evaluation-assets/` (the page's automatic writes to `results/` are the only exception). Never copy test-set audio or transcripts anywhere else.
6. **No transcript text in your report.** The test set contains copyrighted and research-only material. Report numbers only. The summary script below prints numbers only; paste its output as is.
7. **Only the `tiny` and `base` models** (and the small Silero VAD model the engine loads itself). Don't load any other model.
8. **One run at a time, Chrome visible.** Never run two benchmark tabs at once. Keep the Chrome window visible and in front for the whole run: not minimised, not covered by another window, no other tab in front. Background tabs throttle the GPU and ruin the timings.
9. **Don't change the URL parameters** below, including the labels. The labels matter: the page turns the retry safety net **off** when the label is exactly `vad`, and these labels are chosen so it stays **on**.

## Step 0: preflight (stop at the first failure and report it)

Run these from `C:\OffCut` in a terminal.

1. `git log -1 --oneline` must show the commit that added this prompt (message starting `Bench: brief and summary script`). The commit before it must be `1e7eda9 Engine: fix base on WebGPU, drop junk and loops from output`. Check with `git log -3 --oneline`.
2. `git status --short` must print nothing. If it prints anything, stop and report it.
3. `engine/node_modules` must exist. If it's missing, run `npm --prefix engine ci` once and report that you did.
4. `npm --prefix engine run typecheck` must finish with no errors.
5. `npm --prefix engine test` must report **10 test files and 66 tests passed**. Any other count: stop and report.
6. These files must exist: `asr-evaluation-assets/manifest.json`, `asr-evaluation-assets/derived/EN_PODCAST_FULL_reference.txt`, `asr-evaluation-assets/01_english_podcast/audio/original/EN_PODCAST_001_full_episode.mp3`, `engine/manual-english-10m.wav`, `engine/bench/summarize-results.mjs`.
7. Nothing may already be listening on port 5180. Check with `netstat -ano | findstr :5180`. If something is, report the PID and its command line (in PowerShell: `(Get-CimInstance Win32_Process -Filter "ProcessId=<PID>").CommandLine`). Stop it only if it's an old `vite` dev server from this project.
8. Machine state, to report (don't change system settings):
   - Is the laptop on the charger? (It should be.)
   - Which other heavy apps are open? Close games, video editors and other browsers' GPU-heavy tabs.
   - Chrome version (`chrome://version`) and whether `chrome://gpu` shows **WebGPU: Hardware accelerated**. If WebGPU isn't hardware accelerated, stop and report.

## Step 1: start the dev server

From `C:\OffCut`: `npm --prefix engine run dev`. It serves on `http://127.0.0.1:5180`. Leave it running for all four runs. Report the line it prints when ready.

## Step 2: the four runs (in this exact order)

For each run:

1. Open a **new** Chrome tab with the URL, close the previous benchmark tab, and keep the new tab in front.
2. Don't touch the page while it runs. Don't open DevTools during the run (it slows the page).
3. Wait until the status title reads **`Benchmark Finished!`**.
   - If it reads `Benchmark Complete (Save Warning)`, `Benchmark Complete (Save Failed)` or `Benchmark Error`, or the page hasn't changed its progress text for 15 minutes: stop. Copy the exact status text and detail line. Then open DevTools and copy every red console error. Report it all, and don't start the next run.
4. Write down the wall-clock start and end time of the run.
5. Check that a new file `asr-evaluation-assets/results/<label>-<model>-<timestamp>.json` appeared, and that `engine/bench/RESULTS.md` gained a section headed `## Run: <label>`.

The first `base` run may download the `base` model files once (about 100–300 MB) from Hugging Face. That's expected.

| Run | URL | What it measures | Rough time |
|---|---|---|---|
| R1 | `http://127.0.0.1:5180/bench/index.html?model=base&device=webgpu&vad=on&set=all&runs=1&label=r2-base-vad-retry` | `base`, default engine settings, every sample | 20–40 min |
| R2 | `http://127.0.0.1:5180/bench/index.html?model=tiny&device=webgpu&vad=on&set=all&runs=1&label=r2-tiny-vad-retry` | `tiny`, same settings, same session, so R1 vs R2 is fair | 15–30 min |
| R3 | `http://127.0.0.1:5180/bench/index.html?model=base&device=webgpu&vad=off&set=all&runs=1&label=r2-base-vad-off` | `base` with fixed 30 s windows (VAD off, retry still on) | 20–40 min |
| R4 | `http://127.0.0.1:5180/bench/index.html?model=base&device=webgpu&vad=on&set=short&runs=3&label=r2-base-vad-retry-r3` | `base`, short clips three times, to see run-to-run spread | 10–20 min |

**Early stop rule for R1:** the first sample is `EN_PODCAST_001`. When the results table shows its row, look at its WER. It should be roughly 5%. If it is **above 20%**, or its hypothesis word count is 0, stop R1 and report. That means the fix isn't active (wrong commit, stale files or a cached old build).

## Step 3: summarise (read-only)

After all four runs, from `C:\OffCut` run:

```
node engine/bench/summarize-results.mjs asr-evaluation-assets/results r2-
```

It reads the four result files and prints numbers-only tables plus a `FLAGS` list for each run (empty output, junk tokens, a phrase repeated 4+ times, words in silence, VAD not active). It never prints transcript text. Paste its full output into your report unchanged.

Then run `git status --short`. It must show exactly one line: ` M engine/bench/RESULTS.md`. Report its output.

## Step 4: the report

Reply with these sections, in this order:

1. **Preflight:** the output of each check in step 0 (pass/fail plus the actual line), and the machine state.
2. **Runs:** for R1–R4, the status text at the end, start and end times, and the result file name.
3. **Summary script output:** pasted in full, unchanged.
4. **Comparison table, `base` (R1) vs `tiny` (R2), per sample.** Columns: sample, language, WER, deletion rate, CER, wall time. Take every number from the script output; don't recompute.
5. **VAD on (R1) vs VAD off (R3) for `base`**, per sample: WER, deletion rate, max gap, wall time.
6. **Run-to-run spread (R4):** for each sample, the min and max WER and wall time across the 3 runs.
7. **Every FLAG** the script printed, with the run and sample.
8. **Anything unexpected:** errors, warnings, stalls, model downloads, fans or thermal throttling you noticed, anything that differed from this prompt. Write "none" if there was nothing.
9. **Confirmation** that you changed no files and ran no git commands that change anything.

Don't add conclusions, recommendations or explanations of the numbers. The reviewer will interpret them.
