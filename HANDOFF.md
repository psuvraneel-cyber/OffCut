# Offcut handoff

_Last updated: 2026-10-30 (`main` at `c616bf8`, same as GitHub; Phase 2 P0.1–P2.0 committed; P2.1 is next, brief in `docs/p2-1-prompt.md`)_

Read this first if you're picking up the project in a new session.

## What we're building

**Offcut** is a free, open-source, in-browser AI video clipper. Long videos go in; captioned vertical Reels come out. All the AI runs on the user's own device, so the video never leaves their computer.

The owner is building it in public on a new Instagram tech channel, so every milestone doubles as content. The budget is effectively **₹0**.

**How it makes money (later):** display ads on the processing screen, plus optional rewarded ads through Google's opt-in AdSense Offerwall to unlock extras. Normal downloads stay free, with no watermark and no forced ad.

## Where it lives

The project lives at **`C:\OffCut`** (moved out of OneDrive, which kept locking files). Ignore any old copy under OneDrive. GitHub: `https://github.com/psuvraneel-cyber/offcut`; `origin/main` matches local `main` at `c616bf8`. The evaluation corpus, model files and research reports live outside the repo in **`D:\OffCut-Evaluation\`** (`D:` is a `subst` of `C:\`, so it's really `C:\OffCut-Evaluation\`).

## Status right now (2026-10-30)

- **Live:** the marketing site and backend at **`https://offcut-ai.pages.dev`** (Cloudflare Pages free tier).
  - D1 database `clipper-db` (ID `d0ad6cad-064b-432f-80f9-f883d91ad009`), migrations `0001_init.sql` and `0002_seed_features.sql` applied.
  - Production Turnstile (site key in `web/src/lib/turnstile.ts`, secret `TURNSTILE_SECRET_KEY` in Pages secrets) and Cloudflare Web Analytics (token in `web/vite.config.ts`).
  - Owner blanks in `web/privacy.html` and `web/terms.html` filled; Apache 2.0 `LICENSE` and `NOTICE` added.
  - Smoke test passed: `/api/health` answers `ok:true`, roadmap loads from D1, a verified waitlist row landed, branded 404 works.
- **Built and committed since the last handoff:**
  - **Captions page** at `/captions` (`web/captions.html`, `web/src/captions/`): upload a video, transcribe in the browser, edit captions in sync with the video (split, insert, delete), word-by-word overlay, style presets and pacing modes, SRT / VTT / plain-text download, and burned-in video export done client-side (`VideoBurner.ts`).
  - **Smart 9:16 reframe** (`reframing.ts`, `faceDetector.ts`, `cameraTrajectory.ts`): follows the active speaker's face with a smoothed "virtual cameraman".
  - **Engine:** sound cues tagged instead of counted as words; caption cue builder with SRT/VTT exporters (`engine/src/captions.ts`); audio DSP pre-conditioning and window overlap for short videos; Whisper `small` as an optional model; Hindi and Hinglish modes with a script sanity filter and Devanagari→Roman transliteration (`transliterate.ts`); a runtime stage (`engine/src/stage.ts`).
  - **Runtime core** (`runtime/`, package `@offcut/runtime`): runs a job's stages in order, one GPU-heavy stage at a time (Web Locks across tabs), always releases stages, retries on WASM after a lost GPU. The captions page uses it.
  - **Launch reel studio** at `/reel.html` (`web/public/reel.html`) for making the launch motion graphic.
  - **Site polish and SEO:** sitemap, `robots.txt`, metadata and JSON-LD; P0–P2 accessibility, performance and design fixes.
- **Not verified:** whether the live site has been redeployed with the captions page. Check `https://offcut-ai.pages.dev/captions` before announcing it.
- **Left for later:** formal legal review; before ads, a custom domain, the AdSense application and a certified consent tool.

## Engine status

### What works

English is good. Benchmarks (`engine/bench/RESULTS.md`), `base` on WebGPU with VAD and retry:

| Clip | Words wrong |
|---|---|
| NPR podcast clip (101 s) | 4.7% |
| Full podcast episode (28 min) | 5.4% |
| 10-minute English recording | 0.2% |
| Noisy vlog clips | 0–6% |

`tiny` is worse everywhere (full episode 6.2%; podcast clip 12.3% with the new recovery ladder).

### What doesn't: Hindi and Hinglish

An outside audit (`OffCut_Hindi_Hinglish_ASR_Engine_Audit_Report.html` / `.pdf` in the repo root, on commit `19253ea`) rates Hindi and Hinglish **not production-ready**. On `tiny`/WASM with VAD, Hindi averages 116.67% words wrong and Hinglish 94.88%, with 68.9% of Hinglish words dropped.

Its main findings:

1. **Volume boost per window** (`engine/src/audio/decode.ts` calls `conditionAudio()` per window; `normalizePeak` in `dsp.ts`): a quiet window can get up to +45 dB of gain, which turns room hiss into noise Whisper "hears" as words.
2. `tiny` often translates Hindi speech into English instead of transcribing it.
3. `base` writes some Hindi in Urdu (Perso-Arabic) script, and the script filter deletes it, leaving empty output.
4. Transliteration mangles English loanwords (for example "believe" written in Devanagari comes out wrong in Roman).
5. The captions page claims "3× higher accuracy" for the Small model (`web/src/captions/CaptionsPage.tsx`, around lines 770–778). No benchmark has tested `small`.

### Phase 2 P0.1 and P0.1.1: Whisper decoding fixes (committed in `c616bf8`)

At the time of P0.1.1, `npm --prefix engine test` gave 198/198 passing across 20 files with a clean typecheck. P1.1 later added `engine/test/bench-p1-1.test.ts` (212 tests reported).

- **Window planning** (`engine/src/whisper/windows.ts`): policies `baseline`, `fixed_duration`, `largest_pause`, `adaptive_pause`; windows capped at 15 s for conversation.
- **Repetition controls** (`worker.ts`): `repetition_penalty: 1.15` and `no_repeat_ngram_size: 3`.
- **Recovery ladder** (`worker.ts`, `retry.ts`): a flagged window is retried as (1) the full window with the penalties, (2) two halves split at a pause, (3) temperature sampling. `validateCandidateTranscript` rejects loops, one word taking over 60% of the output, foreign scripts and junk over 25%. If every candidate fails, the original window is cleaned instead of swapped for a bad one.
- **Benchmark v2** (`engine/bench/`, see `engine/bench/README.md`): separate scoring per output (`english_latin`, `hindi_devanagari`, `hinglish_roman`, `mixed_diagnostic`), micro and macro WER, script diagnostics, a `hinglish` language queue, and Romanized Hinglish references written to the "OffCut Romanization Standard v1".
- New tests: `bench-wer`, `diagnostics`, `dynamic-windows`, `recovery-ladder`.
- **P0.1.1 fixes (2026-10-30):**
  - **Ladder acceptance bug** (`worker.ts`): candidates are now compared against the original window (`windowResult`) so a shorter, truncated retry isn't accepted blindly. The bug had pushed `EN_PODCAST_001` on `tiny` from 12.29% to 20.34% WER.
  - **Mixed-script junk** (`script.ts`, `detectWordScript`): the foreign-script test (CJK, Cyrillic and others) now runs before the Devanagari and Latin tests, so words like `"र議"` or `"चИचै"` are caught.
- **Benchmark reconciliation (P0.1.1):**
  - The 17.9% deletion rate once reported for `HINGLISH_COSHE_002` (run `D1_rep115_ngram3`) wasn't a real win. The output was 96 junk tokens (Chinese/Cyrillic) that the scorer counted as substitutions instead of deletions, and WER was 97.4%.
  - The 55.6% figure (adaptive-pause windows) is the honest one. The Hindi window is still dropped, but the English window comes out as 47 real, coherent words.
  - `HINGLISH_COSHE_001` has 72 reference words and `HINGLISH_COSHE_003` has 62. An earlier summary table had them swapped by mistake.
- **Experiment matrix A–G on `HINGLISH_COSHE_002`** (`tiny`, WebGPU; WER / words dropped, Hinglish mode):

| Run | Setup | WER | Dropped |
|---|---|---|---|
| G | Full window, plain greedy (baseline) | 99.2% | 98.3% |
| A | Full window, penalties, no ladder | 97.4% | 19.7% (junk) |
| C | Full window, penalties, ladder | 92.3% | 12.0% (RTF 4.07, slow) |
| B / D | Adaptive windows, penalties, with or without ladder | 94.9% | 55.6% |
| E | Adaptive, penalty 1.10, ladder | 93.2% | 53.0% |
| F | Adaptive, penalty 1.15, no n-gram block, ladder | 93.2% | 23.1% |

**Read the results carefully.**
- **Hinglish:** dropped words fell from about 98% to 37–56%, and the output is real dialogue instead of a loop. But **92–95% of words are still wrong.**
- **Hindi:** still at 100% WER.

The fixes stop the engine collapsing; they don't make it accurate.

**Open question on English (`tiny`).** Run alone, `EN_PODCAST_001` gets 12.29% after the ladder fix (13.56% in a later run, RTF 0.229). But in the full short-set run `Phase2_P0_1_1_FullEval_fixed_ladder`, the same clip scored **32.63%**, and the noisy vlogs got 22.92% micro WER, against 16.56–20.83% before. Find out why the full run differs before calling English regression-free. `base` hasn't been re-run on the new code.

**The P0.1.1 write-up's "GO for Phase 2 P1"** (move on to Indic-specialised models such as IndicConformer or fine-tuned Whisper ONNX) was the right direction. The English question above is still open.

### Phase 2 P1.0: Hindi/Hinglish evaluation corpus

- **100 clips, 582.3 s**, in `D:\OffCut-Evaluation\`. All are 16 kHz mono PCM16 WAV, 3–15 s long, with no silent or clipped files.

| Set | Clips | Duration | Source |
|---|---:|---:|---|
| Common Voice Hindi v27.0 | 25 | 134.4 s | `test` split, dual-voted, one clip per speaker |
| AI4Bharat Kathbath Hindi | 25 | 131.9 s | `valid` split, news reading |
| MUCS 2021 Hindi-English | 50 | 316.0 s | Test archive, Spoken Tutorial Project (instructional, not conversation) |

- **Paths:** manifests in `manifests/` (`hindi`, `hinglish`, `combined`, `offcut_benchmark_manifest.json`, `excluded_samples.csv` with the 255 rejected samples), checksums in `checksums/`, licence notes in `licenses/`, and reports `SOURCE_INVENTORY.md` and `REFERENCE_VERIFICATION_REPORT.md`.
- **Caveats:**
  - Every reference is `SOURCE_PROVIDED_UNVERIFIED`; only 15 clips had a spot check.
  - The 50 Romanized Hinglish references (`manifests/hinglish_roman_reference_review.csv`) are machine-made, all `NOT_REVIEWED`, and use academic spellings (`karem`, `haim`, `.n`) rather than natural Hinglish.
  - The Kathbath speaker figures don't add up: 16 speakers, but 13 F + 12 M = 25.

### Phase 2 P1.1: Whisper tiny vs base on the corpus

Four browser runs in Chrome 157 on WebGPU (Intel UHD), 101 clips each: 50 Hindi, 50 Hinglish and 1 English control. Report: `D:\OffCut-Evaluation\reports\PHASE_2_P1_1_MODEL_EVALUATION_REPORT.md`; per-clip results in `reports/results/`.

| Set (profile) | tiny | base |
|---|---:|---:|
| English control `EN_PODCAST_001` | 13.56% | 30.51% |
| Hindi (`hindi_devanagari`) | 103.86% | 98.65% |
| Hinglish (`hinglish_roman`) | 94.96% | 89.16% |
| Hinglish (`hinglish_script_normalized`) | 94.89% | 88.70% |

- **Verdict:** neither model is usable for Hindi or Hinglish. `base` drops far more words (Hindi deletions 15% → 55%), and the recovery ladder barely changes accuracy. Keep `tiny` for English and look for an Indic model.
- **Open:** `base` scored 4.66% on the same English clip in an earlier configuration, and 30.51% here (it dropped a 25-word quote). One English clip is not enough to choose an English model.

### Phase 2 P2.0: Indic model feasibility

Report: `D:\OffCut-Evaluation\reports\PHASE_2_P2_0_MODEL_FEASIBILITY_REPORT.md`; artifacts in `D:\OffCut-Evaluation\p2-model-poc\`; browser test code in `engine/bench/test-conformer.ts` and `run_browser_test.mjs`.

| Candidate | Verdict |
|---|---|
| Indic-Transcribe Flex / Core (1B, Canary-based; 1.7–3.8 GB) | No-go in the browser on this hardware: memory limits, and WebGPU buffer limits on Intel UHD |
| Sherpa-ONNX WASM (investigated build) | No-go: needs threads, so `SharedArrayBuffer` and COOP/COEP |
| **IndicConformer Hindi 120M** (`trysem/indicconformer-120m-onnx`, community ONNX export of `ai4bharat/indicconformer_stt_hi_hybrid_ctc_rnnt_large`) | **Strong Hindi candidate** |

**IndicConformer facts:**
- **Model:** CTC, opset 16, 35 standard operators, no custom ops. 5,632 Devanagari tokens plus blank. Reported licence CC-BY-4.0, not yet checked for the community export.
- **File:** `model.onnx` is 493,060,285 bytes, SHA256 `fb362cae38fd183546d92a614bab2dcb6098702d53efb8e2f6fe850cda43e0d1` (checked 2026-10-30).

**Proof-of-concept results (20 clips, run in Python with `librosa` + `onnxruntime`, `run_poc_evaluation.py`):**

| Set | Clips | WER |
|---|---:|---:|
| Common Voice Hindi | 5 | 2.04% |
| Kathbath Hindi | 5 | 4.76% |
| **Hindi combined** | 10 | **3.57%** (7 of 10 exact) |
| MUCS Hinglish, mixed verbatim | 10 | 61.39% |
| MUCS Hinglish, script-normalised | 10 | 58.86% |
| MUCS Hinglish, Romanized | 10 | 85.80% (references unreviewed) |

**Why Hinglish scores badly:** the model hears English words but writes them in Devanagari (`अकाउंट्स` for accounts, `क्रिएट` for create). Converting the script doesn't turn them back into English words.

**Browser runtime (ONNX Runtime Web, Chrome 157):**

| Backend | Load | Inference | Speed |
|---|---:|---:|---|
| WASM, 1 thread | 3.3 s | 0.51 s | about 3× faster than WebGPU |
| WebGPU | 3.9 s | 1.48 s | |

- Memory peaks at 782 MB and settles at 297 MB after disposal. Twenty passes ran with no crash.
- **These browser numbers came from a random-noise `[1, 80, 200]` tensor (2 s of fake features), not real speech** (`test-conformer.ts`, lines 46–49). The browser has not yet transcribed real audio.

**Proposed design (not built):** a dual engine. English goes to Whisper `tiny`; Hindi goes to IndicConformer on single-threaded WASM, behind a `ModelAdapter` interface. Hinglish needs its own solution.

**Caveats before trusting the 3.57%:**
- It covers only 10 clips.
- The references are unverified.
- Kathbath is AI4Bharat's own dataset, and our clips come from its `valid` split, so training overlap is likely.
- The Python feature extraction has no browser twin yet.
- INT8 quantisation (about 125 MB) is proposed, not tested.

## What's next

1. **Run P2.1 using the revised brief `docs/p2-1-prompt.md`** (it replaces the P2.1 plan in the ChatGPT handoff). In order:
   1. reproduce P2.0 in Python;
   2. run all 100 clips;
   3. prove the browser gives the same features and text as Python on real audio;
   4. test the owner's held-out clips;
   5. audit references and training overlap;
   6. test an English-loanword lexicon for Hinglish;
   7. explain the English contradictions (`tiny` 12.29% vs 32.63%, `base` 4.66% vs 30.51%).
2. **Owner task:** record 10–20 own Hindi/Hinglish clips with typed transcripts in `D:\OffCut-Evaluation\raw\owner_holdout\`, and later review the proposed Romanized Hinglish references.
3. **After P2.1:** if the Hindi gates pass, integrate IndicConformer for Hindi as a beta (adapter, download progress, caching, disposal). Hinglish follows either the lexicon route or a code-switching model, depending on P2.1.
4. **Whisper path, still relevant for English:** the audit's global RMS volume fix (instead of boosting each window) and a temperature fallback schedule `[0.0, 0.2, 0.4]`.
5. **Be honest in the UI:** remove the unverified "3× higher accuracy" Small-model claim (`CaptionsPage.tsx`, around lines 770–778). Label Hindi and Hinglish as experimental until a new engine ships.
6. **Head-to-head against OpusClip** on English clips the owner owns, using a bigger English test set than one clip.
7. **Remaining tool stations:** pick the best moments from a long video (not started), then the full long-video → clips flow on top of captions + reframe + burn-in.
8. **Installable app (PWA, works offline).** The manifest and icons already exist.
9. **Marketing:** drafts for launch threads and directory listings are in `docs/marketing/`.

## Repo map

| Path | What |
|---|---|
| `web/` | Website (React 19 + TS + Vite 8, GSAP/ScrollTrigger, Lenis, Three.js r186). Entries: `index.html`, `captions.html`, `privacy.html`, `terms.html`, `404.html` |
| `web/src/hero/` | Particle hero v2 with quality tiers and a frame watchdog |
| `web/src/sections/` | How it works, Roadmap (feature voting), FAQ, Early access |
| `web/src/components/` | `NavPill`, `Logo`, `Footer`, site-wide `CustomCursor` and `PointerEffects` |
| `web/src/captions/` | Captions page: editor, player overlay, style presets, burn-in export, face-tracking reframe |
| `web/public/` | Favicon, icons, `og.png`, `site.webmanifest`, `_headers`, `robots.txt`, `reel.html` |
| `web/scripts/brand-images/` | Sources for `og.png` and icons; `node web/scripts/brand-images/render.mjs` re-renders them |
| `engine/` | Transcription engine: Whisper via Transformers.js 3.8.1, Silero VAD, DSP, windows, retry/recovery, language/script handling, transliteration, captions export, runtime stage |
| `engine/bench/` | Dev-only benchmark (`RESULTS.md` holds numbers only; `README.md` explains the method; `run_matrix.mjs` runs experiment matrices; `test-conformer.ts` is the IndicConformer browser spike) |
| `runtime/` | `@offcut/runtime`: stage runner with GPU lock, release, cancel and WASM fallback |
| `functions/`, `migrations/`, `shared/`, `test/` | Backend: Pages Functions + D1 + Turnstile |
| `docs/` | `launch.md` (production checklist), `backend-prompt.md` (API contract, source of truth), `backend.md`, `runtime-foundation-plan.md`, `p2-1-prompt.md` (next research brief), `marketing/`, and briefs for other AI sessions |
| `D:\OffCut-Evaluation\` (outside the repo) | 100-clip Hindi/Hinglish corpus, manifests, references, phase reports, IndicConformer model and PoC scripts |

`asr-evaluation-assets/` (English and early test clips, plus bench results) stays local and git-ignored. The audit report is in the repo root.

The home page order is Hero, How it works, Roadmap, FAQ, Early access, then the footer.

## Key decisions (don't undo without a reason)

- **Hosting:** Cloudflare Pages, free tier. Not Vercel: its free Hobby plan bans commercial use, which includes ads. Buy a domain only when adding AdSense, which needs one.
- **Everything heavy runs client-side:** Whisper via Transformers.js (WebGPU first, WASM fallback), WebCodecs for media, face detection in the browser. Model files load from Hugging Face's CDN, never from our host. The ONNX WASM runtime file is self-hosted.
- **Never set COOP/COEP headers.** Cross-origin isolation blocks ad iframes, so nothing may need `SharedArrayBuffer`. This means single-threaded WASM.
- **The backend never receives media.** It stores no IPs and sets no cookies.
- **The API middleware stays in `functions/api/_middleware.ts`.** At the root of `functions/` it would route every static file through Functions and burn the free quota.
- **Production write origins live in `wrangler.toml` under `[env.production.vars]`.** Update them if a custom domain is added.
- **Benchmark honesty:** `RESULTS.md` holds numbers only, never transcript or reference text. The scorer never uses the production transliteration to build references.
- **Originality.** The look was inspired by emotion-agency.com; none of its code or assets are copied.
- **Brand:** name **Offcut**; logo is a tall violet slice tilting out of a wide video frame; palette night `#120b24`, violet `#7a4dff`, violet-deep `#4b23c8`, orchid `#d77bff`, lilac `#c9b8ff`, mist `#f1ecff`, signal `#6fe3ff`; fonts Instrument Serif, Inter, JetBrains Mono (self-hosted).
- **"clipper"** is the internal codename, kept only in package names and the `clipper-db` database name.

## Gotchas

- **Build the website locally with `npm run build:web`.** The root `npm run build` runs `npm ci` inside `web/` (meant for Cloudflare) and once wiped `web/node_modules`.
- **Several AIs work in this folder.** Only one commits at a time. Check `git status` in `C:\OffCut` before assuming what's committed; worktrees under `.claude/worktrees/` don't see uncommitted work in the main folder.
- **Dev servers:** the site is the "web" config in `.claude/launch.json` (port 5173). The backend runs with `npm run dev:api` (port 8788, serves `web/dist`); run `npm run db:migrate:local` once per checkout first. The engine dev server and bench page run with `npm --prefix engine run dev` (port 5180, `http://127.0.0.1:5180/bench/index.html`).
- **Engine checks:** `npm --prefix engine test` and `npm --prefix engine run typecheck`.
- **A stray `C:\postcss.config.mjs`** exists; `web/vite.config.ts` sets an inline PostCSS config to ignore it.
- **After the OneDrive move,** if `web/node_modules` breaks: stop the dev server, run `npm ci` in `web/`, restart. If wrangler misbehaves, run `npm approve-scripts`.
- **Keyboard order:** the skip link and NavPill come before `<main>` in `App.tsx` on purpose.

## Before ads

Buy a domain, apply for AdSense, add a certified cookie-consent tool for EU/UK visitors. Every outward step needs the owner's explicit yes.
