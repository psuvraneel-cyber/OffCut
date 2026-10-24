# Offcut · website

The marketing site and (later) the in-browser clipping tool. React + TypeScript + Vite, with GSAP, Lenis and Three.js for animation.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Layout

- `src/styles/tokens.css`: every colour, font, size and timing value. Change the look here first.
- `src/styles/base.css`: resets and global typography.
- `src/components/`: reusable pieces (e.g. the floating `NavPill`).
- `src/lib/`: non-visual helpers (e.g. smooth scrolling).
- `src/hero/`: the scroll-pinned particle hero. `engine/` runs one WebGL renderer and loop for every hero
  system (GPU particle simulation in `particles/`, pointer input in `interaction/`). `LiteParticleField.ts`
  is the v1 fallback for GPUs without float render targets, and the CSS gradient is the last resort.
- `public/_headers`: Cloudflare Pages response headers.

The backend (`/functions`, `/migrations`, `/shared`) lives at the repo root and is specified in `docs/backend-prompt.md`.

## Hero debug flags

Add these to the URL while testing the hero:

- `?tier=high|medium|low|lite|static` forces a quality tier (otherwise it's picked from the device).
- `?motion=reduce` behaves as if the OS asked for reduced motion.
- `?debug` shows frame rate, tier and particle count, and exposes the engine as `window.offcutHero`.
