# Third-party notices

Offcut's website bundles the open-source code below. Everything is installed through npm (or adapted
into our source with its licence header kept) and served from our own host. Nothing loads from a
runtime CDN.

## Adapted into our source

### webgl-noise (simplex noise)

- Used in: `src/hero/glsl/noise.ts` (3D simplex noise, plus a variant with its analytic gradient that
  we use for curl noise)
- Source: https://github.com/ashima/webgl-noise, https://github.com/stegu/webgl-noise
- Authors: Ian McEwan, Ashima Arts; Stefan Gustavson
- Licence: MIT

```
Copyright (C) 2011 by Ashima Arts (Simplex noise)
Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Bundled npm packages

| Package | Used for | Licence |
|---|---|---|
| `three` (incl. `examples/jsm` addons such as `GPUComputationRenderer`) | WebGL rendering, GPU particle simulation | MIT |
| `postprocessing` (pmndrs) | Hero bloom, tone mapping, vignette, grain, chromatic aberration | Zlib |
| `gsap` | Scroll timeline and tweens | GreenSock Standard "No Charge" licence |
| `lenis` | Smooth scrolling | MIT |
| `react`, `react-dom` | UI | MIT |
| `@fontsource/instrument-serif` | Display font | OFL-1.1 (font), MIT (package) |
| `@fontsource-variable/inter` | Body font | OFL-1.1 (font), MIT (package) |
| `@fontsource/jetbrains-mono` | Mono font | OFL-1.1 (font), MIT (package) |
