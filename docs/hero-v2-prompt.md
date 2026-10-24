# Hero v2 build prompt

Paste everything below the line into a new Claude Code session opened on this project folder.

---

## Your job

Upgrade the Offcut website's hero section in **six phases, in order**. Each phase must ship working, verified and committed before the next one starts. Don't stop between phases unless you hit a decision only I can make. If so, ask me one clear question and wait.

1. GPU particle physics (curl noise + springs)
2. Fluid-simulation cursor + "swipe to cut" gesture
3. Film-grade post-processing (bloom, grain, vignette)
4. "Timeline horizon" wallpaper (procedural 3D world behind the particles)
5. Camera choreography + intro sequence
6. Automatic quality tiers + performance pass (build tier hooks from Phase 1 onward, finish them here)

## Context you need first

Read these before writing any code:
- Your memory files (MEMORY.md is loaded automatically).
- `web/README.md`
- Everything in `web/src/hero/`, `web/src/styles/tokens.css`, `web/src/lib/smoothScroll.ts` and `web/src/components/NavPill.tsx`.

**The product.** Offcut is a free, open-source, in-browser AI video clipper: long videos in, captioned vertical Reels out, and nothing leaves the user's device. I'm building it in public on Instagram, so every phase should look great on screen. The budget is ₹0: no paid assets, services or libraries.

**The stack (in `web/`).** React 19 + TypeScript + Vite 8, GSAP 3 (ScrollTrigger), Lenis smooth scroll, Three.js r186 (WebGLRenderer). Fonts are self-hosted via @fontsource (Instrument Serif, Inter Variable, JetBrains Mono).

**The hero today (v1).** It works and is committed.
- `Hero.tsx` pins the section for `+=300%` of scroll. A GSAP timeline tweens `scroll.value` 0 → 3 with `HOLD = 0.3`, crossfades the four step texts, and snaps to labels `step-0`…`step-3`. A progress counter shows 01–04.
- The four steps, in order:
  1. "Long videos in."
  2. "Reels out."
  3. "Captions that pop."
  4. "Nothing leaves your device."
- `ParticleField.ts` is a Three.js `Points` cloud (9k desktop / 5k phones). Each particle's positions for every shape are attributes; the vertex shader blends cloud → frame → phone → "captions" text → laptop with a per-particle stagger, plus a sine "swirl".
  - The cursor parts and heats particles (raycast to the shape plane → `uMouse`).
  - There's a pointer-parallax tilt.
  - Particles move by layout: desktop ≥900px puts the shape on the right; narrow screens fit it above the text using `getTextTop()`.
- `shapes.ts` has seeded generators for each shape (the "captions" word is rasterised from a canvas). Reuse them.
- `CursorTrail.ts` is a 2D-canvas sparkle trail (mouse and pen only).
- Three.js is lazy-loaded (`import()`) so the text paints first. There's a static CSS-gradient fallback (`.hero--static`) when WebGL fails, and reduced motion is respected throughout.

**The palette (from tokens.css).**
- Night `#120b24`
- Violet `#7a4dff` (particles use a lighter `#9b7bff`)
- Violet-deep `#4b23c8`
- Orchid `#d77bff` (particles `#e08bff`)
- Signal cyan `#6fe3ff` (sparingly)
- Lilac `#c9b8ff`
- Mist `#f1ecff`

## Hard rules (never break these)

1. **Originality.** Don't copy code, shaders, 3D models, textures or sounds from emotion-agency.com or any other site. Ideas and techniques are fine; their assets and code are not.
2. **Licences.** Only free, permissively licensed libraries (MIT, BSD, Apache), installed through npm and bundled. No runtime CDNs.
   - Allowed: Three.js addons (e.g. `GPUComputationRenderer`), `postprocessing` (pmndrs, MIT), GLSL simplex noise (Ashima/Stefan Gustavson, MIT).
   - If you adapt anyone's code, keep their licence header and list it in `web/THIRD_PARTY_NOTICES.md`.
3. **No `Cross-Origin-Embedder-Policy` / `Cross-Origin-Opener-Policy`.** Cross-origin isolation would block the site's ads. Nothing may require `SharedArrayBuffer`.
4. **Don't regress v1 behaviour.**
   - Step text crossfades, snapping, the progress counter, the NavPill.
   - The visually hidden `<h1>` and `aria-hidden` canvases.
   - The text-first paint via lazy loading.
   - The narrow-screen layout where the shape sits above the text and never overlaps it.
   - No horizontal scroll at 375px.
5. **Reduced motion** (`prefers-reduced-motion: reduce`): no curl noise, fluid, camera flights, intro or cut effects. Shapes still change per step, but calmly (fast settle, no swirl).
6. **Touch devices.** No fluid sim, no custom cursor and no cut gesture, because swipes are for scrolling. A tap may trigger the shockwave. Scrolling must always feel native.
7. **Keep v1 as a fallback.** Rename `ParticleField.ts` → `LiteParticleField.ts` (keep it working). The fallback ladder is GPU tiers → lite (v1) → static CSS.
8. **Code style.** Match the existing code.
   - TypeScript with the `erasableSyntaxOnly` rule: no constructor parameter properties, no enums.
   - `noUnusedLocals`.
   - Short "why" comments, the same naming style, CSS values from tokens.
9. **Commands.** Build and lint the frontend with `npm --prefix web run build` and `npm --prefix web run lint`.
   - Never run the root `npm run build`: it runs `npm ci` and wipes `web/node_modules`.
   - If `web/node_modules` breaks (OneDrive file locks), stop the dev server, run `npm ci` in `web/` and restart.
10. **Commits.** I pre-authorise one commit per finished phase on `main`, staging only `web/` and `docs/` files you changed. Never stage backend files, `.dev.vars` or anything you didn't touch. End each commit message with the usual Co-Authored-By line.

## Target architecture (adjust if you have a better reason, and say why)

```
web/src/hero/
  Hero.tsx / Hero.css        text, scroll timeline, mounts the engine
  engine/
    HeroEngine.ts            renderer, scene, camera, loop, resize, pause/resume, dispose
    quality.ts               tier detection, runtime FPS watchdog, URL overrides
    layout.ts                desktop/narrow framing (move WIDE_LAYOUT_MIN here)
  particles/
    ParticleSim.ts           GPUComputationRenderer: position + velocity textures
    simShaders.ts            velocity/position update GLSL (springs, curl noise, forces)
    ParticleRenderer.ts      draws particles from the position texture
    shapes.ts                existing generators, now also packed into DataTextures
  fluid/
    FluidSim.ts              stable-fluids solver on render targets
    fluidShaders.ts
  interaction/
    pointer.ts               unified pointer state (screen + world coords, speed)
    cutGesture.ts            stroke detection → cut events
    CustomCursor.tsx/.css    ring + dot cursor, magnetic buttons
  post/
    composer.ts              postprocessing EffectComposer setup per tier
  world/
    Sky.ts                   dusk sky dome, aurora, stars
    Horizon.ts               waveform mountains + timeline ground
  choreography/
    cameraPath.ts            scroll-linked camera keyframes
    intro.ts                 load-in sequence
  LiteParticleField.ts       v1, kept as the fallback
  CursorTrail.ts             kept only for the lite tier
```

**One WebGL renderer and one canvas** for everything (world, particles, post). The engine owns the loop. Every system implements `update(dt, state)` and `dispose()`. Use a fixed simulation step (1/60 s, at most 2 substeps per frame) so physics stays stable.

## Phase 1: GPU particle physics

**Goal.** Particles that move like smoke and settle like springs, at far higher counts.

- **Simulation.** Use `GPUComputationRenderer` with two RGBA textures: position (xyz + spare) and velocity (xyz + spare).
  - Texture size comes from the tier: 384² ≈ 147k high, 256² ≈ 65k medium, 128² ≈ 16k low.
  - Use `FloatType`; fall back to `HalfFloatType` if `EXT_color_buffer_float` is missing. Without WebGL2 or float/half-float render targets, use the lite tier.
- **Targets.** Pack each shape (cloud, frame, phone, captions, laptop) from `shapes.ts` into a `DataTexture` of the same size.
  - Pass a random value per particle (texture or derived hash).
  - Each particle switches its target from shape A to shape B when the morph progress passes its own staggered threshold, like v1's stagger.
- **Velocity update, per particle:**
  - **Spring:** `(target − position) × stiffness`, with damping (`velocity *= exp(−damping·dt)`). Tune so morphs overshoot slightly and settle in about 0.6–0.9 s.
  - **Curl noise:** 3D curl of simplex noise, sampled at `position × scale + time`. Strong while transitioning (proportional to how far the particle is from its target), and a faint drift at rest.
  - **Pointer force:** the existing "part around the cursor" behaviour, rewritten as a force. In Phase 2 it gets replaced by the fluid.
  - Clamp max speed.
- **Rendering.** Read the position and velocity textures in the vertex shader.
  - Size attenuation as in v1.
  - Colour from the palette by per-particle random, shifting towards hot pink-white with speed.
  - Fast particles stretch into short streaks along their screen-space velocity. Use instanced quads, or a points-based approximation if quads are too slow on the medium tier (measure and justify the choice).
  - Additive blending, soft round glow.
- **Scroll.** Keep `Hero.tsx`'s timeline, labels and snapping. The engine reads `scroll.value` (0–3) and the intro value exactly as v1 does.
- **Parallax tilt and layout framing** work as in v1.
- **Debug URL params** (used by all later phases):
  - `?tier=high|medium|low|lite|static` forces a tier.
  - `?motion=reduce` forces reduced-motion behaviour.
  - `?debug` shows a small overlay with FPS, tier and particle count.
- **Done when:** morphs visibly overshoot and settle, transitions swirl like smoke, and it holds ~60 fps on the medium tier on my laptop. Forced lite and static tiers must still work.

## Phase 2: fluid cursor, swipe to cut, shockwave, custom cursor, magnetic buttons

- **Fluid sim.** Write our own stable-fluids solver: advect velocity and dye, compute curl, apply vorticity confinement, compute divergence, run Jacobi pressure iterations, subtract the gradient.
  - Use half-float render targets at tier resolution: 256 grid with 25 pressure iterations on high, 128 with 18 on medium, none on low.
  - Pointer movement injects velocity splats proportional to pointer speed.
  - The particle velocity update samples the fluid velocity at each particle's screen position, so the cursor stirs the particles like ink, and the stirring lingers after the mouse stops.
  - Optionally render the faint dye as a soft glow underlay (keep it subtle).
- **Remove `CursorTrail`** from the GPU tiers. Keep it on lite.
- **Swipe to cut** (mouse and pen only).
  - A stroke counts as a cut when it covers more than 120 px in under 250 ms at a speed above roughly 1.2 px/ms. Allow at most one cut per 600 ms.
  - Project the stroke into particle space. Particles within a band around the line get an impulse away from it (sign by side), so the shape splits in two.
  - A bright seam glows along the cut (a fading line, ~600 ms).
  - The springs then knit the shape back together.
  - Add a matching fluid splat along the stroke.
- **Click / tap shockwave.** A radial impulse from the point, plus an expanding glow ring (~500 ms).
- **Custom cursor** (fine pointers only, hero and nav).
  - A small lilac ring plus a dot that trail the pointer smoothly (GSAP `quickTo`).
  - The ring grows and snaps around interactive elements.
  - Hide the native cursor only over the hero. Focus outlines and keyboard use stay untouched.
- **Magnetic buttons.** The hero CTAs and the NavPill CTA lean up to ~8 px towards a cursor within ~60 px.
- **Done when:** stirring feels liquid, a fast flick visibly slices the current shape and it reforms, and nothing happens on touch except the tap shockwave. Lite and reduced-motion paths are unchanged.

## Phase 3: post-processing

- **Add `postprocessing` (pmndrs).** Effects by tier:

| Tier | Bloom | Other effects |
|---|---|---|
| High | Half resolution | Grain, vignette, chromatic aberration, depth of field |
| Medium | Half resolution | Grain, vignette |
| Low | Quarter resolution, or a CSS vignette instead | None |

  - **Bloom:** mipmap blur, luminance threshold tuned so only dense or fast particles bloom.
  - **Film grain:** very subtle.
  - **Vignette.**
  - **Chromatic aberration:** tiny, stronger at the edges.
  - **Depth of field:** near particles blur softly.
  - **Tone mapping:** AgX or ACES. Re-tune particle colours afterwards so they still match the palette.
- **Size check.** Check the lazy hero chunk size after adding it. The target is ≤ ~250 KB gzip for the whole lazy hero chunk.
- **Done when:** it looks premium, not washed out. Text stays crisp (post only applies to the WebGL canvas), and medium still holds ~60 fps.

## Phase 4: "timeline horizon" wallpaper

The idea: Offcut's own world. The long video is the landscape we cut from. Generate everything in code, with no image assets.

- **Sky.** A large sphere or full-screen shader, rendered first.
  - A dusk gradient: night at the top → violet → orchid glow at the horizon.
  - Slowly drifting aurora ribbons (fbm noise).
  - Sparse twinkling stars.
- **Waveform mountains.** Two or three silhouette layers at increasing distance, whose ridgelines look like an audio waveform (bars or rounded peaks driven by noise).
  - Atmospheric fog fades distant layers into the sky.
  - Gentle parallax with scroll and the pointer tilt.
- **Timeline ground.** A large plane running to the horizon, drawn as a video-editor timeline in a shader:
  - thin track lanes
  - rounded clip blocks in palette colours
  - small keyframe diamonds
  - a glowing playhead line
  - soft fog and a faint sheen

  The timeline slides towards the camera as you scroll. During the intro, particles rise off it to form the first shape.
- **Integration.** The world renders in the same scene, before the particles, so bloom and depth of field apply. On narrow screens the horizon sits lower so the text stays readable (keep the existing bottom gradient overlay). The CSS gradient stays as the static fallback.
- **Tiers.** Low gets simpler noise, one mountain layer and no aurora.
- **Done when:** the hero feels like a place, not a backdrop. It stays readable at all three widths, and medium holds ~60 fps.

## Phase 5: camera choreography + intro

- **Scroll-linked camera.** Keyframe the camera position and look-at target against the existing step labels, so they stay in sync with the text and snapping:
  - Step 1 → 2: dolly towards, then *through*, the wide frame's play button, and swing around as it folds into the tall phone.
  - Step 2 → 3: drift sideways as the phone dissolves into "captions".
  - Step 3 → 4: pull back to reveal the laptop with the horizon behind it.

  Framing must respect the layout rules: shape on the right on desktop, above the text on narrow screens. Update `layout.ts` to fit shapes for a moving camera.
- **Intro.** On load:
  1. near-dark screen
  2. one spark appears where the shape will form
  3. it bursts outwards into the dust cloud
  4. particles rise off the timeline and gather into the wide frame
  5. the text fades in

  It takes ≤ 2.8 s in total. Scrolling is never blocked: if the user scrolls, the intro fast-forwards. It plays fully once per browser session (sessionStorage, wrapped in try/catch) and plays shortened after that. Skip it entirely for reduced motion.
- **No sound.**
- **Done when:** it feels like a film shot, the text and camera never fight, and snapping still lands on clean compositions.

## Phase 6: quality tiers + performance pass

- **Tier detection at start.** Check WebGL2 plus float/half-float render targets, `renderer.capabilities`, `navigator.hardwareConcurrency`, `navigator.deviceMemory` (if present), screen size and `pointer: coarse`.
  - **Coarse pointer or a small screen:** start on low.
  - **Otherwise:** start on medium, or high when the hardware looks strong.
- **Runtime watchdog.** Sample frame times for ~60 frames after the intro. If the average is above 20 ms, step down one tier, and keep checking. Only ever step **down** during a session (no flicker).
- **Tier table:**

| Tier | Particles | Fluid grid / iterations | Bloom | Depth of field | Other effects | Max pixel ratio |
|---|---|---|---|---|---|---|
| High | 384² | 256 / 25 | Half resolution | Yes | Grain, vignette, chromatic aberration | 1.75 |
| Medium | 256² | 128 / 18 | Half resolution | No | Grain, vignette | 1.5 |
| Low | 128² | None (direct pointer force) | Quarter resolution or none | No | Vignette | 1.25 |
| Lite | v1, 5–9k | — | — | — | — | 1.5 |
| Static | CSS only | — | — | — | — | — |

- **Pausing.**
  - Stop the loop entirely when the hero is off-screen or the tab is hidden (`visibilitychange`).
  - Export `pauseHero()` / `resumeHero()` (or a window CustomEvent) so the clipping tool can free the GPU later.
- **Cleanup.** `dispose()` must free every render target, texture, geometry and material. React StrictMode mounts twice in dev, so make sure nothing leaks (check `renderer.info.memory` before and after a remount).
- **Report a table of results** covering, for each tier on my laptop:
  - lazy chunk size
  - average FPS
  - GPU memory (`renderer.info`)
- **Fix the worst offender.**
- **Done when:** forcing each tier via `?tier=` works, and the watchdog demonstrably steps down when throttled (simulate a slow GPU by forcing extra substeps under `?debug=slow`).

## How to verify every phase

1. `npm --prefix web run build` and `npm --prefix web run lint` both pass.
2. Start the dev server with the "web" launch config, then check it in the Browser pane at **1280×800**, **800×700** and **375×812** (mobile preset):
   - Screenshot each step (scroll to the snap points).
   - Check the console for errors.
   - Confirm no horizontal scroll and no text overlap.
   - Reset the viewport afterwards.
3. Exercise the new interactions with hover, drag and click actions, and screenshot the effect mid-action. If screenshots time out because the pane is hidden, use `get_page_text`/JS measurements and tell me.
4. Measure FPS with a small `requestAnimationFrame` probe via the JS tool (note: a hidden pane throttles rAF, so say if numbers look throttled). Also check `?tier=lite`, `?tier=static` and `?motion=reduce`.
5. Commit the phase (see the commit rule), then give me a short report:
   - what changed
   - how you verified it
   - FPS per tier
   - anything you couldn't verify
   - a one-line idea for an Instagram Reel showing off this phase

Then move straight on to the next phase.
