# clipper · website

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
- `public/_headers`: Cloudflare Pages response headers.

The backend (`/functions`, `/migrations`, `/shared`) lives at the repo root and is specified in `docs/backend-prompt.md`.
