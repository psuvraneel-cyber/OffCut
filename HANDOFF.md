# Offcut handoff

_Last updated: 2026-10-25_

Read this first if you're picking up the project in a new session.

## What we're building

**Offcut** is a free, open-source, in-browser AI video clipper. Long videos go in; captioned vertical Reels come out. All the AI runs on the user's own device, so the video never leaves their computer.

The owner is building it in public on a new Instagram tech channel, so every milestone doubles as content. The budget is effectively **₹0**.

**How it makes money (later):** display ads on the processing screen, plus optional rewarded ads through Google's opt-in AdSense Offerwall to unlock extras. Normal downloads stay free, with no watermark and no forced ad.

## Repo map

| Path | What | Status |
|---|---|---|
| `web/` | Website (React 19 + TS + Vite 8, GSAP/ScrollTrigger, Lenis, Three.js r186) | Committed |
| `web/src/hero/` | Particle hero v1: scroll-pinned morphs (video → phone → "captions" → laptop), cursor heat and parting, sparkle trail | Committed (`c999c31`) |
| `web/src/components/` | `NavPill` (floating dark-glass menu), `Logo` (Offcut mark) | Committed |
| `functions/`, `migrations/`, `shared/`, `test/` | Backend: Cloudflare Pages Functions + D1 + Turnstile (waitlist, feedback, feature votes, clip counter, error reports) | Committed (`b02384b`), reviewed and fixed |
| `engine/` | Transcription engine (Whisper in the browser) | **Not started.** Omnirush builds it from `docs/engine-transcription-prompt.md` |
| `docs/backend-prompt.md` | Backend spec and API contract (source of truth) | Committed |
| `docs/backend.md` | Backend setup and deploy guide | Committed |
| `docs/hero-v2-prompt.md` | Six-phase hero upgrade brief for a new Claude session | Uncommitted |
| `docs/engine-transcription-prompt.md` | Transcription engine brief for Omnirush | Uncommitted |

Commits on `main`, oldest first:

1. `d2b75df`: the backend prompt
2. `7034a30`: the website skeleton
3. `c999c31`: the hero, effects and branding
4. `b02384b`: the backend

## Work in progress (in parallel)

1. **Hero v2** (new Claude session, brief: `docs/hero-v2-prompt.md`). Six phases, in order:
   1. GPU particles
   2. Fluid cursor + swipe-to-cut
   3. Bloom/post-processing
   4. Timeline-horizon world
   5. Camera + intro
   6. Quality tiers

   It edits `web/` only and commits each phase itself.
2. **Transcription engine** (Omnirush, brief: `docs/engine-transcription-prompt.md`). It works only in `engine/` and does **not** commit. Review it against the brief afterwards (run its tests and the demo on port 5180), then commit.

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
- **The project lives in OneDrive,** so file locks happen. If `web/node_modules` breaks: stop the dev server, run `npm ci` in `web/`, restart. Moving the project out of OneDrive (e.g. `C:\Projects\offcut`) would help.
- **There's a stray `C:\postcss.config.mjs` on the C: drive.** `web/vite.config.ts` sets an inline PostCSS config to ignore it.
- **Two AIs work in this folder.** Only one of them commits at a time; Omnirush never commits.
- **The local dev server for the site** is the "web" config in `.claude/launch.json` (port 5173). The backend runs locally with `npm run dev:api` (port 8788, serves `web/dist`).

## Before going live (not done yet)

1. `npx wrangler d1 create clipper-db`, then paste the ID into **both** D1 sections of `wrangler.toml`.
2. Run `npm run db:migrate:remote`.
3. Create a real Turnstile widget. Set the secret with `npx wrangler pages secret put TURNSTILE_SECRET_KEY`, and add the site key to the frontend.
4. Deploy: `npm run build:web`, then `npx wrangler pages deploy web/dist --project-name offcut`. Check that the production `ALLOWED_ORIGINS` matches the address you got.
5. Write a privacy policy and terms (India DPDP, Turnstile, later AdSense cookies) before collecting emails.
6. Before ads: buy a domain, apply for AdSense, add a certified cookie-consent tool for EU/UK visitors.

## What's next after the parallel work

1. Review and commit Omnirush's `engine/`.
2. Website sections:
   - How it works
   - Early-access form (wired to `/api/waitlist` with Turnstile)
   - Feature-voting roadmap (`/api/features`)
   - FAQ
   - Footer
3. Build the tool, one station at a time:
   1. split the audio out
   2. transcribe (from `engine/`)
   3. pick the best moments
   4. reframe wide to tall around faces
   5. paint captions
   6. encode with WebCodecs
   7. download

   Ship the free auto-captioner first.
4. Installable app (PWA, works offline), then launch.
