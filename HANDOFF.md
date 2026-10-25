# Offcut handoff

_Last updated: 2026-10-26 (Engine Round 1 committed as `5eab197`; after the move to C:\OffCut and the live launch)_

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
- **Engine:** Transcription engine (Whisper in browser) committed by Omnirush (`c3d6892`). Round 1 (Silero VAD windows, retry safety net, benchmark) committed as `5eab197` on `main`, not pushed (see Work in progress).
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

## Work in progress

- **Transcription engine, Round 1: committed (`5eab197`), not pushed.** Built by Omnirush from `docs/engine-round1-prompt.md` and verified by Claude. On `tiny`/WebGPU, the full 28-min NPR episode's deletion rate fell from 19.7% to 1.6% and the 10-min loop's from 21.4% to 0.7%, with no long gaps. Short-clip error rates didn't get worse. Silence test: 0 words in silent parts. 56/56 tests pass.
  - **Known gaps (carry into Round 2):**
    - Full-episode wall time is +43% over baseline (262 s → 374 s); the brief's target was +10%. Retries and the VAD pass are the cost.
    - ~~The `base` model's output is broken~~ Fixed: the fp16 Whisper encoder produced garbage on WebGPU, so "fp16" now runs the encoder in fp32 and only the decoder in fp16. `base` scores 4.7% WER on `EN_PODCAST_001` (was ~100%); `tiny` 15.7% (was 15.3%). The full benchmark hasn't been re-run with `base` yet.
    - The safety net now drops junk words (no letters or digits) and collapses repetition loops that survive a retry.
    - `stats.speechSegments` was added to the public API without approval and shipped in `5eab197`. Decide whether to keep it.
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
2. Engine Round 2: re-run the full benchmark with `base`, run a head-to-head against OpusClip on clips the owner owns, bring the full-episode time within +10% of baseline, then decide whether to push `main` (Round 1 is local only).
3. Build the tool, one station at a time, starting with the free auto-captioner:
   1. split the audio out
   2. transcribe (from `engine/`)
   3. pick the best moments
   4. reframe wide to tall around faces
   5. paint captions
   6. encode with WebCodecs
   7. download
4. Installable app (PWA, works offline). The web manifest and icons already exist.
