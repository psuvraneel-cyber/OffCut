# Offcut handoff

_Last updated: 2026-10-26 (engine CPU fixes committed as `1bdeb32`; runtime foundation M0 done; ONNX WASM self-hosted; after the move to C:\OffCut and the live launch)_

Read this first if you're picking up the project in a new session.

## What we're building

**Offcut** is a free, open-source, in-browser AI video clipper. Long videos go in; captioned vertical Reels come out. All the AI runs on the user's own device, so the video never leaves their computer.

The owner is building it in public on a new Instagram tech channel, so every milestone doubles as content. The budget is effectively **₹0**.

**How it makes money (later):** display ads on the processing screen, plus optional rewarded ads through Google's opt-in AdSense Offerwall to unlock extras. Normal downloads stay free, with no watermark and no forced ad.

## Where it lives

The project lives at **`C:\OffCut`** (moved out of OneDrive, which kept locking files). Ignore any old copy under OneDrive. GitHub: `https://github.com/psuvraneel-cyber/offcut` (`main` there has only the README commit `c1389ec`).

## Status right now (2026-10-25, live on offcut-ai.pages.dev)

- **The marketing site and backend are LIVE** at **`https://offcut-ai.pages.dev`** on Cloudflare Pages free tier.
- **Database:** D1 database `clipper-db` (ID: `d0ad6cad-064b-432f-80f9-f883d91ad009`) created and migrated (`0001_init.sql` and `0002_seed_features.sql`). Both IDs set in `wrangler.toml`.
- **Bot protection:** Production Cloudflare Turnstile widget is active with real site key in `web/src/lib/turnstile.ts` and secret key in Cloudflare Pages secrets (`TURNSTILE_SECRET_KEY`).
- **Analytics:** Cloudflare Web Analytics active with token in `web/vite.config.ts`.
- **Legal & License:** Owner blanks filled in `web/privacy.html` and `web/terms.html`, draft notices removed, and Apache License 2.0 with `NOTICE` added.
- **GitHub:** Pushed to `https://github.com/psuvraneel-cyber/OffCut` on branch `main`.
- **Smoke test verified:** Health check (`/api/health`) answers `ok:true`, roadmap features load from D1, owner verified waitlist signup lands in D1 (1 verified row), branded 404 works.
- **Engine:** Transcription engine (Whisper in browser) is on `main` at `1bdeb32`, 5 commits ahead of GitHub (not pushed). It has Silero VAD, a safety net for junk, loops and skipped speech, `base` as the default on every device, and a self-hosted ONNX WASM file. See Work in progress.
- **What's left for later:** Formal legal review, and before ads: custom domain, Google AdSense application, and certified consent tool.

## Repo map

| Path | What | Status |
|---|---|---|
| `web/` | Website (React 19 + TS + Vite 8, GSAP/ScrollTrigger, Lenis, Three.js r186) | Committed, launch-ready apart from the owner's blanks |
| `web/src/hero/` | Particle hero v2: GPU particle physics with quality tiers (GPU high/medium, lite, static) and a frame watchdog that steps down a tier when frames run long; fluid cursor with swipe-to-cut; bloom/post-processing; timeline-horizon world; camera choreography and intro | Finished (phases 1–6, `a878f08`…`444801c`) |
| `web/src/sections/` | How it works, Roadmap (feature voting), FAQ, Early access (waitlist form) | Finished and merged |
| `web/src/components/` | `NavPill` (floating menu), `Logo`, `Footer`, site-wide `CustomCursor` and `PointerEffects` | Finished |
| `web/privacy.html`, `web/terms.html`, `web/404.html` | Legal drafts (owner blanks highlighted) and the branded 404 page, as extra Vite entries | Committed |
| `web/public/` | Favicon, app icons, `og.png` share card, `site.webmanifest`, `_headers` | Committed |
| `web/scripts/brand-images/` | HTML sources for `og.png` and the icons; `node web/scripts/brand-images/render.mjs` re-renders them with headless Edge/Chrome | Committed |
| `functions/`, `migrations/`, `shared/`, `test/` | Backend: Cloudflare Pages Functions + D1 + Turnstile (waitlist, feedback, feature votes, clip counter, error reports) | Committed (`b02384b`), 12/12 tests pass |
| `engine/` | Transcription engine (Whisper in the browser) | Base committed (`c3d6892`). Round 1 committed (`5eab197`): Silero VAD two-pass windows, retry safety net, dev-only benchmark in `engine/bench/`. Test-set results stay local (`asr-evaluation-assets/` is git-ignored) |
| `docs/launch.md` | Production checklist: what's verified, go-live commands, Turnstile and Web Analytics steps | Committed |
| `docs/backend-prompt.md` | Backend spec and API contract (source of truth) | Committed |
| `docs/backend.md` | Backend setup and deploy guide | Committed |
| `docs/hero-v2-prompt.md`, `docs/engine-transcription-prompt.md` | Briefs for the hero v2 session and Omnirush | Committed |

The page order is Hero, How it works, Roadmap, FAQ, Early access, then the footer. The site-wide cursor (`CustomCursor` + `PointerEffects`) steps aside inside the hero, which draws its own pointer effects.

## Phase 2 P0.1 & P0.1.1 Status: Dynamic Window Slicing, Recovery Ladder & Benchmark Reconciliation (Completed)

- **Completed Implementation & Forensic Audit (Phase 2 P0.1.1):**
  1. **Discrepancy A Reconciled (17.9% vs 55.6% Deletion Rate):** Resolved the experimental anomaly on `HINGLISH_COSHE_002`. The reported 17.9% deletion rate in D1 was caused by **hallucinatory word stuffing** (96 random tokens containing Chinese/Cyrillic ideographs aligned by Levenshtein as substitutions, $S=93, D=21, I=0$, with a disastrous 97.43% WER). The integrated adaptive-pause configuration split the sample at pause boundaries; Window 0 (Hindi) was dropped by Whisper `tiny`, but Window 1 transcribed **47 real spoken English words with grammatical coherence** ($S=46, D=65, I=0$), yielding 55.56% deletions, but lower WER (94.87%) and genuine speech fidelity.
  2. **Discrepancy B Reconciled (`COSHE_001` Word Count):** Reconciled on-disk references. `HINGLISH_COSHE_001` has exactly **72 words** in both Devanagari mixed and Romanized references. `HINGLISH_COSHE_003` has exactly **62 words**. The discrepancy was an accidental typographical transposition in an earlier text summary table.
  3. **Discrepancy D & E Reconciled (English Regression & Ladder Bug Fix):** Reconciled historical English regression WER figures: 32.20% (WASM CPU q8), 12.29% (WebGPU baseline), 20.34% (WebGPU P0.1 ladder bug), and 4.66% (model `base`). Fixed the Recovery Ladder candidate acceptance flaw in `engine/src/whisper/worker.ts`: candidate transcripts are now checked against `windowResult` to prevent blind acceptance of truncated outputs. On `EN_PODCAST_001`, regression WER dropped straight back down from 20.34% to **12.29%** (matching baseline).
  4. **Foreign Script Masking Fixed (`src/whisper/script.ts`):** `detectWordScript` now tests `OTHER_FOREIGN_SCRIPTS_REGEX` before `DEVANAGARI_REGEX` and `LATIN_REGEX`, correctly filtering hybrid CJK/Cyrillic hallucinations (`"र議"`, `"चИचै"`).
  5. **Controlled Matrix Experiments (A through G):** Executed complete 7-experiment matrix on `HINGLISH_COSHE_002` and full evaluation suite across all benchmark categories. Confirmed baseline greedy collapse (Exp G: 98.29% deletion rate, 99.15% WER) and confirmed that repetition suppression + pause-anchored windowing eliminates autoregressive traps while achieving real-time factors down to 0.229x.
  6. **Comprehensive Test Suite:** 198 unit tests passing across 20 test files (`npm --prefix engine test`). Zero TypeScript compilation errors (`npm --prefix engine run typecheck`).

## Phase 2 P1.0 Status: Hindi & Hinglish Evaluation Dataset Ingestion & Curation (Completed)

- **Workspace:** `D:\OffCut-Evaluation\` (mapped via `subst D: C:\` to `C:\OffCut-Evaluation\`).
- **Curated Dataset Assets (100 Standardized Utterances, 582.3s total audio):**
  1. **Hindi Subcorpus (50 clips, 266.3s, 41 distinct speakers):**
     - 25 clips from **Mozilla Common Voice Hindi v27.0** (`test.tsv`, dual-voted `up >= 2, down == 0`, pure Devanagari sentences, 1 clip per speaker).
     - 25 clips from **AI4Bharat Kathbath Hindi Valid** (news reading, perfectly balanced 13 Female / 12 Male speakers across 16 distinct speakers).
  2. **Hinglish Subcorpus (50 clips, 316.0s, 26 distinct speakers):**
     - 50 code-switched instructional utterances from **Interspeech MUCS 2021 Hindi-English Test Archive** (Spoken Tutorial Project).
     - Strict bilingual code-switching: minimum 2 Latin words + 3 Devanagari words (mean 4.2 Latin / 9.8 Devanagari words per utterance, code-switch ratio 0.44).
     - Sliced with 5 ms boundary linear micro-taper to eliminate window edge click transients.
- **Audio Standardization Standard:**
  - 100% compliant **16,000 Hz, mono, signed 16-bit PCM WAV (`pcm_s16le`)** with standard RIFF canonical headers.
  - Zero silence files (RMS > -40.0 dBFS), zero digital clipping/saturation, strictly bounded duration (3.0s – 15.0s).
- **Manifests & Documentation Generated:**
  - `manifests/hindi.json`, `hindi.csv`
  - `manifests/hinglish.json`, `hinglish.csv`
  - `manifests/combined.json`
  - `manifests/offcut_benchmark_manifest.json` (formatted for direct ingestion into OffCut benchmark harness)
  - `manifests/excluded_samples.csv` (255 rejected candidate samples with taxonomy of reasons)
  - `checksums/SHA256SUMS.txt` (207 cryptographic hashes)
  - `licenses/source-licenses.md` (CC0-1.0, CC-BY-4.0, CC BY-SA 4.0 legal audit)
  - `reports/SOURCE_INVENTORY.md`
  - `reports/REFERENCE_VERIFICATION_REPORT.md` (Human verification protocol & 15-sample acoustic audit)
  - `DATASET_CARD.md` & `README.md`
- **Milestone Decision:** **DEFINITIVE GO**. Proceed to **Phase 2 P1.1: Browser-Based ASR Model Benchmark Execution & Comparative Evaluation**.

## Phase 2 P1.1 Status: Browser-Based ASR Model Benchmark Execution & Comparative Evaluation (Completed)

- **Workspace:** `D:\OffCut-Evaluation\` (mapped via `subst D: C:\` to `C:\OffCut-Evaluation\`) and `C:\OffCut`.
- **Execution Architecture:** Chrome 157, WebGPU acceleration (Intel UHD Gen-12LP), Transformers.js v3.8.1, ONNX Runtime Web v1.22.0-dev.
- **Experimental Matrix Executed:** 4 controlled browser benchmark runs across 101 standardized clips (50 Hindi, 50 Hinglish, 1 English control `EN_PODCAST_001`), totaling **404 sample evaluations** and **804 scored observations**:
  - **Exp A:** Whisper Tiny, WebGPU, Recovery OFF (baseline) — 271.3s wall time (RTF 0.442x).
  - **Exp B:** Whisper Tiny, WebGPU, Recovery ON (`ladder`) — 276.3s wall time (RTF 0.443x).
  - **Exp C:** Whisper Base, WebGPU, Recovery OFF (baseline) — 360.9s wall time (RTF 0.613x).
  - **Exp D:** Whisper Base, WebGPU, Recovery ON (`ladder`) — 788.6s wall time (RTF 1.343x).
- **Comparative Results Summary:**

  | Partition & Scoring Profile | Metric | Exp A (Tiny, Rec OFF) | Exp B (Tiny, Rec ON) | Exp C (Base, Rec OFF) | Exp D (Base, Rec ON) |
  |---|---|---|---|---|---|
  | **01_english_podcast [en]** (`english_latin`) | Micro WER<br>Deletion Rate<br>Mean RTF | 13.56%<br>6.36%<br>0.259x | 13.56%<br>6.36%<br>0.281x | 30.51%<br>23.73%<br>0.249x | 30.51%<br>23.73%<br>0.324x |
  | **02_hindi [hi]** (`hindi_devanagari`) | Micro WER<br>Deletion Rate<br>Mean RTF | 103.86%<br>15.06%<br>0.392x | 103.86%<br>15.06%<br>0.393x | 99.23%<br>59.85%<br>0.599x | **98.65%**<br>**55.02%**<br>1.668x |
  | **03_hinglish [hinglish]** (`hinglish_roman`) | Micro WER<br>Deletion Rate<br>Mean RTF | 94.96%<br>23.05%<br>0.495x | 94.96%<br>23.05%<br>0.496x | 89.01%<br>46.26%<br>0.634x | **89.16%**<br>**44.58%**<br>1.039x |
  | **03_hinglish [hinglish]** (`hinglish_mixed_verbatim`) | Micro WER<br>Deletion Rate | 97.37%<br>22.45% | 97.37%<br>22.45% | 91.95%<br>45.67% | **92.11%**<br>**43.96%** |
  | **03_hinglish [hinglish]** (`hinglish_script_normalized`) | Micro WER<br>Deletion Rate | 94.89%<br>22.91% | 94.89%<br>22.91% | 88.54%<br>45.67% | **88.70%**<br>**43.96%** |

- **Key Engineering Conclusions & Selection Verdicts:**
  1. **Neither Whisper Tiny nor Base is Production-Ready for Hindi/Hinglish (REJECTED):** Aggregate WERs (89% - 104%) are far above the usable product ceiling ($\le 20-25\%$). 9 out of 10 spoken words are misrecognized or dropped.
  2. **Whisper Base Exhibits Severe Deletion / Omission Bias:** Hindi deletions jumped from 15.06% (Tiny) to 55.02% (Base), and Hinglish deletions from 23.05% to 44.58%. Base drops entire phrases or outputs empty strings rather than risk phonetic substitutions.
  3. **English Control Regression on Base:** Whisper Base degraded to 30.51% WER on `EN_PODCAST_001` (vs 13.56% on Tiny) due to dropping a 25-word quotation in Window 1.
  4. **Recovery Ladder Validated:** The P0.1.1 recovery ladder neutralized 8 severe Urdu/Perso-Arabic script drift hallucinations (reducing foreign characters to 0) and suppressed 3 punctuation junk loops, lowering Kathbath deletions by 6.56 pp with zero regressions on clean English.
  5. **Strategic Architecture Decision (CONFIRMED):** OffCut will adopt a **Dual-Engine Architecture**:
     - Retain lightweight Whisper Tiny (or Base) for English transcription (13.56% WER, RTF 0.259x).
     - Deploy a dedicated, specialized Indic ASR model (AI4Bharat IndicConformer or IndicWhisper) conditionally when Hindi or Hinglish is selected.
- **Artifacts Generated & Validated:**
  - Full Engineering Report: `reports/PHASE_2_P1_1_MODEL_EVALUATION_REPORT.md` (and artifact `PHASE_2_P1_1_MODEL_EVALUATION_REPORT.md`).
  - Machine-readable result files in `D:\OffCut-Evaluation\reports\results\`: `tiny_results.json`, `base_results.json`, `recovery_ablation_results.json`, `model_comparison.json`, `sample_level_metrics.csv`, and immutable run traces `expA` through `expD`.
  - Human verification work queue: `manifests/hinglish_roman_reference_review.csv` (50 items) + standalone review tool `scripts/review_tool.html`.
  - Permanent benchmark suite: `engine/bench/main.ts` (multi-profile scoring, persistent caching), `engine/bench/run_matrix.mjs`, and 14 unit tests in `engine/test/bench-p1-1.test.ts` (212 tests passing).
- **Next Phase:**
  - **Phase 2 P2.0 (Completed):** Indic ASR Model Compatibility, Browser Runtime Feasibility & Architecture Selection.
  - **Phase 2 P2.1 (Next):** Model quantization (INT8 ~125MB), browser DSP mel front-end in TypeScript, IndicConformer adapter, and Dual-Engine integration.

## Phase 2 P2.0 Status: Indic ASR Model Compatibility, Browser Runtime Feasibility & Architecture Selection (Completed)

- **Audited Candidates:**
  1. **AI4Bharat / Bodhan AI Indic-Transcribe Flex & Core (1B Canary):** 1.71 GB (INT8) / 2.45 GB (FP16). Exceeds 32-bit browser WASM 2 GB buffer cap; WebGPU buffer allocation fails on Intel UHD graphics. `NO-GO` for in-browser client deployment.
  2. **Sherpa-ONNX Runtime (WASM):** C++ Emscripten WASM runtime. Requires `SharedArrayBuffer` (pthreads) and COOP/COEP headers, directly conflicting with OffCut's ad monetization requirement (Google AdSense Offerwall iframe isolation). Redundant with ONNX Runtime Web. `NO-GO`.
  3. **AI4Bharat IndicConformer Hindi 120M (`trysem/indicconformer-120m-onnx`):** Conformer CTC (~120M params, 493 MB FP32 / ~125 MB INT8). Non-autoregressive, 35 standard opset 16 operators, zero custom ops, CC-BY-4.0 license.
- **Empirical 20-Sample Proof-of-Concept Results (Common Voice, Kathbath, MUCS):**
  - **Hindi Recognition:** Achieved **3.57% aggregate WER** (Common Voice: **2.04%**, Kathbath: **4.76%**). Error reduction of **100.29 pp** vs Whisper Tiny (103.86% -> 3.57%) and **95.08 pp** vs Whisper Base (98.65% -> 3.57%). 7/10 clips achieved 0.00% WER.
  - **Hinglish Recognition:** Accurately recognizes spoken English technical terms and writes them phonetically in Devanagari (`accounts` -> `अकाउंट्स`, `create` -> `क्रिएट`, `format` -> `फॉर्मेट`). Yields 61.39% Mixed Verbatim WER (due to Devanagari vs Latin reference orthography) and 58.86% script-normalized WER. Requires downstream transliteration adapter for Romanized captions.
  - **Latency & Speed:** Native RTF is **0.029x** (mean latency 182.6 ms), ~35x faster than real-time.
- **Browser Runtime Execution in Chrome 157 (WebGPU vs WASM):**
  - **WASM (1 thread, COOP/COEP compliant):** Session load 3,304.7 ms, inference 508.9 ms (RTF ~0.25x). Runs with 100% operator coverage.
  - **WebGPU (JSEP):** Session load 3,947.3 ms, inference 1,477.5 ms. Shape/metadata operators assigned to CPU, incurring CPU-GPU memory copy overhead on integrated Intel UHD. WASM CPU is ~3x faster than WebGPU for this model.
- **Dual-Engine Architecture Selected:**
  - Route English audio to **Whisper Tiny** (`onnx-community/whisper-tiny_timestamped`) on WebGPU.
  - Route Hindi and Hinglish audio to **IndicConformer Hindi 120M** on WASM (single-threaded).
  - Chain downstream deterministic transliteration (`transliterateDevanagariToHinglish`) when Romanized subtitles are requested.
- **Artifacts & Deliverables:**
  - Full Report: `D:\OffCut-Evaluation\reports\PHASE_2_P2_0_MODEL_FEASIBILITY_REPORT.md` (and artifact `PHASE_2_P2_0_MODEL_FEASIBILITY_REPORT.md`).
  - Machine-readable evidence: `candidate_inventory.json`, `operator_compatibility.json`, `runtime_test_results.json`, `poc_transcriptions.json`, `poc_metrics.csv`, `model_resource_measurements.json` in `D:\OffCut-Evaluation\p2-model-poc\` and `reports/results\`.
- **Milestone Decision:** **DEFINITIVE GO for Hindi, CONDITIONAL GO for Hinglish.** Proceed to Phase 2 P2.1.

## Work in progress

- **Engine status (`main`, `1bdeb32`):**
  - Round 1 (VAD windows, retry safety net, benchmark) is committed. Full benchmark results are in `engine/bench/RESULTS.md`.
  - Fixed since: `base` on WebGPU (fp16 encoder produced garbage; now fp32 encoder, fp16 decoder). Speaker dashes stripped; runaway output capped. Self-hosted ONNX WASM. CPU quality: `tiny` on q8 looped, so `base` is now the default everywhere; a skipped-speech check triggers retries.
  - Benchmark, `base` on WebGPU: NPR clip 4.7% words wrong, full 28-min episode 5.4%, 10-min loop 0.2%, noisy vlog clips 0–6%. `tiny` is worse everywhere (full episode 6.2%). Hindi and Hinglish are unusable with both (about 90–100% wrong).
  - Runtime foundation M0 is done (`0f593bd`): the model and VAD session are fully released, and a lost GPU is recovered by restarting the worker and using the CPU. M1 is not started.
- **Engine to-do before the captioner (in progress):**
  1. Tag sound cues like "(laughing)" and "(upbeat music)" instead of treating them as words. Brief prepared for Antigravity; not yet run.
  2. Keep `stats.speechSegments` and document it (decided: keep, optional, only with VAD).
  3. Word-timing check for word-by-word captions: later, at the start of the caption step.
  4. Re-run the full benchmark with the skipped-speech check (it may add retries or time on long files).
- **Known gaps (carry forward):**
    - Full-episode wall time is +43% over baseline (262 s → 374 s); the brief's target was +10%. Retries and the VAD pass are the cost.
    - `stats.speechSegments` was added without approval in `5eab197`; now being kept and documented (item 2 above).
    - With `vad: false`, the retry also runs (the brief said exact old behaviour). `retry: false` is an internal flag that restores it.
    - Hindi and Hinglish stay poor with `tiny`. That's a model limit.
    - On a repetition loop, retry acceptance takes a loop-free retry even with fewer words (a deliberate deviation).
  - Benchmark runs and the bench page need the dev server (`npm --prefix engine run dev`, port 5180). `asr-evaluation-assets/` stays local and untracked.
- **Going live:** follow `docs/launch.md`. The site is built and checked; what's left needs the owner's accounts.

## Key decisions (don't undo without a reason)

- **Hosting:** Cloudflare Pages, free tier. The project is named `offcut` → `https://offcut.pages.dev`.
  - Not Vercel: its free Hobby plan bans commercial use, which includes ads.
  - Buy a domain only when adding AdSense, which needs one.
- **Everything heavy runs client-side:** Whisper via Transformers.js (WebGPU first, WASM fallback), WebCodecs/Mediabunny for media, MediaPipe for faces later. AI model files load from Hugging Face's CDN, never from our host.
- **Never set COOP/COEP headers.** Cross-origin isolation blocks ad iframes, so nothing may need `SharedArrayBuffer`. This means single-threaded WASM.
- **The backend never receives media.** It stores no IPs and sets no cookies.
- **The API middleware must stay in `functions/api/_middleware.ts`.** At the root of `functions/`, it would route every static file through Functions and burn the free quota.
- **Production write origins live in `wrangler.toml` under `[env.production.vars]`.** Update them if the pages.dev address differs or a custom domain is added.
- **Originality.** The look was inspired by emotion-agency.com, but none of its code or assets are copied.
- **Brand:**
  - Name: **Offcut**
  - Logo: a tall violet slice tilting out of a wide video frame
  - Palette: night `#120b24`, violet `#7a4dff`, violet-deep `#4b23c8`, orchid `#d77bff`, lilac `#c9b8ff`, mist `#f1ecff`, signal `#6fe3ff`
  - Fonts: Instrument Serif, Inter, JetBrains Mono (self-hosted)
- **"clipper"** is the internal codename and survives only in package names and the `clipper-db` database name.

## Gotchas

- **Build the website locally with `npm run build:web`** (or `npm --prefix web run build`). The root `npm run build` runs `npm ci` inside `web/` (it's meant for Cloudflare) and wiped `web/node_modules` once.
- **The project moved from OneDrive to `C:\OffCut`.** Old worktrees and notes may still point at the OneDrive path; ignore them. If `web/node_modules` ever breaks: stop the dev server, run `npm ci` in `web/`, restart. npm paused some install scripts at the root after the move; if wrangler misbehaves, run `npm approve-scripts`.
- **There's a stray `C:\postcss.config.mjs` on the C: drive.** `web/vite.config.ts` sets an inline PostCSS config to ignore it.
- **Two AIs work in this folder.** Only one of them commits at a time; Omnirush never commits.
- **The local dev server for the site** is the "web" config in `.claude/launch.json` (port 5173). The backend runs locally with `npm run dev:api` (port 8788, serves `web/dist`). Run `npm run db:migrate:local` once per checkout first.
- **Never add COOP/COEP headers** (see Key decisions). `web/public/_headers` says so too.
- **Keyboard order:** the skip link and the NavPill come before `<main>` in `App.tsx` on purpose, even though the pill floats at the bottom. The hero's first-Tab handler shows the intro text at once so its buttons can take focus.

## Before going live

Everything that can be done without the owner's accounts is done and checked. The full checklist, with the exact commands and click-by-click Turnstile and Web Analytics steps, is in **`docs/launch.md`**. In short: owner blanks (links, legal pages, licence) → D1 database + remote migrations → Turnstile widget → Pages project + deploy → Turnstile secret → smoke test → push to GitHub. Each outward step needs the owner's explicit yes.

Before ads: buy a domain, apply for AdSense, add a certified cookie-consent tool for EU/UK visitors.

## What's next

1. Go live (above).
2. Finish the engine to-do (see Work in progress), then the captioner. Realistic cut for the first release: a **captions file download (SRT/VTT)** on the website, which Instagram, YouTube and CapCut accept. Burned-in captions (video decode, render and encode, on the runtime foundation from `docs/runtime-foundation-plan.md`) come after.
3. Head-to-head against OpusClip on clips the owner owns, then decide whether to push `main` (5 commits are local only).
3. Build the tool, one station at a time, starting with the free auto-captioner:
   1. split the audio out
   2. transcribe (from `engine/`)
   3. pick the best moments
   4. reframe wide to tall around faces
   5. paint captions
   6. encode with WebCodecs
   7. download
4. Installable app (PWA, works offline). The web manifest and icons already exist.
