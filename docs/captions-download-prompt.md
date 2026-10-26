# Captions download prompt (for Gemini in Antigravity)

Copy everything below the line into Antigravity.

---

## Who you are and what this is

You are a senior front-end engineer. You're adding the first real feature to an existing, working website. Work carefully and in the existing code style. **Don't rewrite or reorganise anything that already exists.**

**The project:** Offcut is a free, open-source, in-browser AI video clipper. Long videos go in, captioned vertical Reels come out. **Everything runs on the user's own device.** "Your video never leaves your computer" is the main promise. The budget is zero. The site is live at `https://offcut-ai.pages.dev` (Cloudflare Pages).

**This task:** a **free captions-file download page**. The user picks a video, the speech engine transcribes it in their browser, they can fix any mistakes, and they download an **SRT** and a **VTT** caption file. Instagram, YouTube and CapCut accept these. There's no video rendering in this task.

A reviewer (Claude) checks your work afterwards against this prompt and the code, so **report honestly**, including anything you couldn't do or verify. A wrong claim is worse than a reported gap.

## Where you work

- **Folder:** `C:\OffCut-captions`. This is a git worktree of the project on branch **`feat/captions-download`**, created by the owner. All paths below are relative to it.
- **Never touch `C:\OffCut` itself or any other folder.** Another AI is working in `C:\OffCut-runtime` at the same time.
- **First-time setup**, from `C:\OffCut-captions`:
  - `npm --prefix engine ci`
  - `npm --prefix web ci`
  - `npm --prefix engine test`: must report 97 passing tests before you change anything. If not, stop and report.

## Read these first, in order

1. `HANDOFF.md`: project overview, decisions and gotchas.
2. `engine/README.md`, `engine/src/types.ts`, `engine/src/index.ts`: the transcription engine's public API. **Use only what `engine/src/index.ts` exports.**
3. `web/vite.config.ts`, `web/tsconfig.app.json`, `web/package.json`, `web/src/App.tsx`, `web/src/main.tsx`, `web/src/styles/tokens.css`, `web/src/styles/base.css`, `web/privacy.html`, `web/src/components/NavPill.tsx`, `web/src/components/Footer.tsx`.
4. `docs/launch.md`, section 5 (how the site is built and deployed).

## Facts you can rely on (verified by the reviewer)

- **The engine API.**
  - `createTranscriber({ model: "base" })` returns an object with `load(onProgress?)`, `transcribe(file, { language, signal, onProgress })` and `dispose()`.
  - `transcribe()` resolves to a `Transcript` with:
    - `language`, `duration` and `granularity`;
    - `segments`;
    - `words`: each word is `{ text, start, end, kind? }`, times in seconds, and `kind: "cue"` marks sound cues like `(laughing)`;
    - `stats`.
  - Progress events are:
    - `{ stage: "download", file, loaded, total }`
    - `{ stage: "load" }`
    - `{ stage: "decode", seconds, duration }`
    - `{ stage: "transcribe", seconds, duration }`
  - Errors, all exported from `engine/src/index.ts`: `AbortError`, `UnsupportedFormatError`, `NoAudioTrackError`, `ModelLoadError`, `OutOfMemoryError`, `GpuLostError`.
  - `detectCapabilities()` resolves to `{ webgpu, shaderF16, webcodecsAudio, recommendedModel, recommendedDevice }`.
- **The engine runs in its own Web Worker.**
  - It uses WebGPU when available and otherwise falls back to the CPU (WASM).
  - It loads the speech model from Hugging Face on first use and caches it in the browser.
  - It serves ONNX Runtime's 21.6 MB `.wasm` file as its own build asset. This is under Cloudflare Pages' 25 MiB file limit.
- **`base` is the right model on every device.** Measured: about 5% of English words wrong on a podcast, 0–6% on noisy vlogs. Hindi and Hinglish are not usable yet (about 90–100% wrong), so the page must say English only.
- **How the site deploys.** It is built **on the owner's PC** with `npm --prefix web run build` and then uploaded with wrangler. Cloudflare doesn't build it. So the website can import the engine's source directly, and the engine's packages resolve from `engine/node_modules`.
- **The website type check.** `tsc -b` uses `web/tsconfig.app.json`, whose `lib` is `["ES2023", "DOM"]`. The engine's worker uses `DedicatedWorkerGlobalScope`, which needs the `WebWorker` lib. The engine's own tsconfig uses `["ES2022", "DOM", "WebWorker"]` with `skipLibCheck: true` without problems.

## Hard rules (breaking any of these fails the task)

1. **Allowed files.** Change only these:
   - **Everything under `web/`,** except `web/public/_headers` and the hero (`web/src/hero/`), which you must not touch.
   - **New files `engine/src/captions.ts` and `engine/test/captions.test.ts`,** plus adding their exports to `engine/src/index.ts` and one section to `engine/README.md`. No other engine changes.
   - **The `build` script in the root `package.json`** (step 6 below), and **section 5 of `docs/launch.md`**.

   Never touch `functions/`, `shared/`, `migrations/`, the root `test/`, `HANDOFF.md`, `wrangler.toml`, `.gitignore` or anything else.
2. **No new npm dependencies** anywhere, and no version changes.
3. **Git:**
   - You may commit, **only on `feat/captions-download`**, with clear messages.
   - Never push, merge, rebase, switch branches, stash or reset.
   - Never touch the `main` branch.
4. **Never run the root `npm run build`** (it runs `npm ci` and wipes `web/node_modules`). Build with `npm --prefix web run build`.
5. **Privacy.**
   - The video and the transcript never leave the browser: no upload, no API call, no analytics events carrying content.
   - The only network requests the page may add are the engine's model downloads from Hugging Face.
6. **Never add COOP/COEP headers** or anything that needs cross-origin isolation (`SharedArrayBuffer`). Ads must keep working later.
7. **Don't guess APIs.** For anything you use from the engine, Vite or React, read the actual source or types in `node_modules`. If something doesn't work as described here, **stop and report it.** Don't invent a workaround outside the allowed fixes listed in step 5.
8. **Keep the home page light.** The engine (worker, model loader, the WASM file) must load **only on the captions page**, never in the home page's JavaScript. Step 9 says how to check.
9. **Code style.** Match the surrounding code:
   - `web/`: single quotes, no semicolons, 2-space indent, React function components, plain CSS files next to components, existing CSS variables from `tokens.css`.
   - `engine/`: double quotes, semicolons, 2-space indent, TypeScript strict, `erasableSyntaxOnly` (no `enum`, no constructor parameter properties), every tunable number in one exported constants object.

## What to build

### 1. Caption building in the engine: `engine/src/captions.ts`

Pure functions, no browser APIs, fully unit-tested.

```ts
export const CAPTION_CONSTANTS = {
  maxCharsPerLine: 32,   // short lines read well on a phone in a vertical Reel
  maxLines: 2,
  maxCueSeconds: 5,
  maxGapSeconds: 1.0,    // a pause longer than this starts a new caption
  minCueSeconds: 0.7,
} as const;

export interface CaptionCue { start: number; end: number; text: string } // text may contain "\n" between lines

export interface CaptionOptions extends Partial<typeof CAPTION_CONSTANTS> {
  includeSoundCues?: boolean; // default false
}

export function buildCaptionCues(words: readonly Word[], options?: CaptionOptions): CaptionCue[];
export function toSrt(cues: readonly CaptionCue[]): string;
export function toVtt(cues: readonly CaptionCue[]): string;
```

**Rules for `buildCaptionCues`, in this order:**

1. Drop words with `kind === "cue"` unless `includeSoundCues` is true. Drop words whose trimmed text is empty.
2. Walk the words in time order and add each one to the current caption. **Start a new caption before a word** when any of these is true:
   - The caption's text plus a space plus the word wouldn't fit in `maxLines` lines of `maxCharsPerLine` characters when wrapped (use the wrapping rule in step 3).
   - The pause since the previous word (`word.start - previous.end`) is greater than `maxGapSeconds`.
   - Adding the word would make the caption longer than `maxCueSeconds` (`word.end - caption.start`).
   - The previous word ends with `.`, `?` or `!` (a sentence ends).
3. **Wrapping.** Greedily fill line 1 with whole words up to `maxCharsPerLine` characters (spaces count), then line 2, and so on.
   - Never split a word.
   - A single word longer than `maxCharsPerLine` sits on its own line.
   - A caption whose words need more than `maxLines` lines must already have been split by step 2. The only exception is a single word that's too long, which forms a caption on its own.
4. **Timing.**
   - A caption starts at its first word's `start` and ends at its last word's `end`.
   - Then extend each caption's `end` to at least `start + minCueSeconds`, but never past the next caption's `start`.
   - Captions never overlap, and their starts never decrease.
   - Clamp negative times to 0.
5. Line texts are the words joined by single spaces, and lines are joined by `"\n"`.

**SRT (`toSrt`):**
- Cues are numbered from 1.
- Timestamps are `HH:MM:SS,mmm --> HH:MM:SS,mmm`, rounded to the millisecond, with hours above 99 allowed.
- Then the text lines, then a blank line.
- Use `\r\n` line endings throughout.
- No cues gives an empty string.

**VTT (`toVtt`):**
- The file starts with `WEBVTT` and a blank line.
- Each cue is `HH:MM:SS.mmm --> HH:MM:SS.mmm`, then the text lines, then a blank line.
- Use `\n` line endings.
- In the text, escape `&` as `&amp;`, `<` as `&lt;` and `>` as `&gt;`, and replace `-->` with `→`.
- No cues gives `"WEBVTT\n"`.

**Export** `buildCaptionCues`, `toSrt`, `toVtt`, `CAPTION_CONSTANTS` and the two types from `engine/src/index.ts`. This public API addition is approved.

**Tests (`engine/test/captions.test.ts`), each with exact expected values:**
1. A sentence of 8 short words becomes 1 caption with 2 wrapped lines, with exact text and times.
2. Too many characters for 2 lines splits into 2 captions at a word boundary.
3. A 1.5 s pause between words starts a new caption.
4. A word ending in `?` ends the caption.
5. A 6-second run of words is split before it passes 5 s.
6. A 45-character word sits alone on its own line, in its own caption.
7. A sound cue is dropped by default and kept with `includeSoundCues: true`.
8. A 0.2-second one-word caption is extended to 0.7 s, but not past the next caption's start.
9. The exact SRT string for 2 captions, with `\r\n` endings, including a time over 1 hour (`01:02:03,456`).
10. The exact VTT string with escaping of `&`, `<` and `-->`.
11. Empty input gives `[]`, then `""` (SRT) and `"WEBVTT\n"` (VTT).

Add a short "Captions" section to `engine/README.md` describing these functions and their defaults.

### 2. A separate captions page: `/captions`

- **New Vite entry `web/captions.html`.**
  - Copy the `<head>` of `web/privacy.html` (favicon, manifest, theme colour and `og:` tags) and adapt it.
  - Title: `Free captions file · Offcut`.
  - Canonical and `og:url`: `https://offcut-ai.pages.dev/captions`.
  - Description: "Make an SRT or VTT captions file from your video, free, in your browser. Your video never leaves your device."
  - Its script is `web/src/captions/main.tsx`, which renders `<CaptionsPage />` into `#root`.
  - Import the same global styles and fonts that `web/src/main.tsx` imports. **Don't import the hero, GSAP, Lenis, Three.js, the custom cursor or the smooth scroll.**
- **Add it to `build.rolldownOptions.input`** in `web/vite.config.ts` as `captions: page('./captions.html')`. Cloudflare Pages serves `captions.html` at `/captions`.
- **Files:** put the page in `web/src/captions/` (`CaptionsPage.tsx`, `CaptionsPage.css`, plus any small components you need).

### 3. The page, step by step

The page is light and calm, uses the brand tokens (`--mist` background, `--ink` text, `--violet` accents, `--font-display` for the heading), and works at phone width with a 16px side gutter. It has these states:

1. **Intro.**
   - Heading: "Free captions file".
   - One line: "Your video never leaves your device. The speech model runs in your browser."
   - A note: "English only for now."
   - A small "← Back to Offcut" link to `/`.
2. **Pick a file.**
   - A drop zone that is also a button that opens the file picker (`accept="video/*,audio/*"`). It works by keyboard and shows a focus ring.
   - After picking, show the file name and size.
   - A checkbox: "Include sound cues like (laughing)", off by default.
   - A **Make captions** button.
3. **Capability note,** from `detectCapabilities()`, shown before starting:
   - If `webgpu` is false: "Your browser will use the CPU. It works, but it's slower."
   - If `webcodecsAudio` is false: "This browser decodes some formats slowly; files over 200 MB may not work."
4. **Working.**
   - Create the transcriber with `createTranscriber({ model: "base" })` once per page and reuse it for later files. Call `dispose()` on page unload.
   - Call `transcribe(file, { language: "en", signal, onProgress })`.
   - Show one progress bar and a status line:
     - **Downloading the speech model.** Show total MB loaded of total MB, summed across files by `file` name (only on first use). Add the hint "(first time only)".
     - **Preparing** during `load`.
     - **Reading audio** during `decode`, as `seconds/duration`.
     - **Transcribing** during `transcribe`, as `seconds/duration`.
   - Use an `aria-live="polite"` status region.
   - Show a **Cancel** button. It aborts via `AbortController` and returns to the pick state. A cancel is not an error.
5. **Result.**
   - Run `buildCaptionCues(transcript.words, { includeSoundCues })`.
   - Show the captions as a list: start time (`m:ss`) plus an editable `<textarea>` per caption with an accessible label like "Caption 3, 0:12".
   - Edits change only that caption's text. Times stay the same.
   - Buttons:
     - **Download SRT**: `toSrt` of the edited captions, file name `<original name without extension>.srt`, MIME `application/x-subrip`.
     - **Download VTT**: `toVtt`, `.vtt`, MIME `text/vtt`.
     - **Copy text**: all caption texts joined by newlines, copied to the clipboard, with "Copied" feedback.
     - **Start over**.
   - Downloads use a `Blob` plus `URL.createObjectURL` plus a temporary `<a download>`. Revoke the URL afterwards.
   - Show "Detected language: X" only if it isn't `en`, as a warning that results may be poor.
   - If there are no captions: "No speech found in this file."
6. **Errors.** Use friendly messages, a **Try again** button, and never a raw stack trace:

   | Error | Message |
   |---|---|
   | `UnsupportedFormatError` | "This file format isn't supported. Try MP4, WebM, MP3, WAV, OGG or FLAC." |
   | `NoAudioTrackError` | "This file has no sound." |
   | `ModelLoadError` | "The speech model couldn't load. Check your connection and try again." |
   | `OutOfMemoryError` | the error's own message |
   | `GpuLostError` | "Your graphics processor stopped responding. Try again; it will use the CPU." |
   | anything else | "Something went wrong. Try again." Also log the error to the console. |

- **Accessibility:**
  - All controls are reachable and usable by keyboard, with visible focus.
  - Buttons are real `<button>` elements.
  - Respect `prefers-reduced-motion`; no animation is needed.
  - Colour contrast at least WCAG AA.

### 4. Links to the page

- **`web/src/components/Footer.tsx`:** add `{ href: '/captions', label: 'Free captions file' }` to the sections list.
- **`web/src/components/NavPill.tsx`:** add `{ href: '/captions', label: 'Captions' }` to its links array. If that breaks the pill's layout at phone width, leave NavPill unchanged and report it.

### 5. Wiring the website to the engine

1. **Alias.** In `web/vite.config.ts`, add `resolve.alias` `'@offcut/engine'` pointing to `fileURLToPath(new URL('../engine/src/index.ts', import.meta.url))`. Import the engine in the website **only** as `@offcut/engine`.
2. **Type check.** In `web/tsconfig.app.json`:
   - add `"paths": { "@offcut/engine": ["../engine/src/index.ts"] }`;
   - add `"WebWorker"` to `lib`.
3. **Allowed fixes if something breaks.** Use only these, and report every one you used:
   - Dev server refuses `../engine` files: add `server.fs.allow` with `searchForWorkspaceRoot(process.cwd())` plus the engine folder.
   - Worker build errors about code-splitting or format: add `worker: { format: 'es' }`.
   - Dev server dependency pre-bundling breaks the engine's worker: add `optimizeDeps: { exclude: ['@huggingface/transformers'] }`.

   Anything else: stop and report.

### 6. Build script and docs

- **Root `package.json` `build` script:** change it to `npm --prefix engine ci && npm --prefix web ci && npm --prefix web run build`. Don't run it.
- **`docs/launch.md` section 5:** before `npm --prefix web run build`, add a line saying the engine's packages must be installed once with `npm --prefix engine ci`, because the website imports the engine's source.

## Checks (all must pass, run them in this order)

1. `npm --prefix engine run typecheck`
2. `npm --prefix engine test`: report the count. It must be 97 plus your new caption tests.
3. `npm --prefix web run lint`
4. `npm --prefix web run build`: this runs `tsc -b` and `vite build`. No errors.
5. **Home page stays light.**
   - In `web/dist/index.html`, find the main JS file it loads. Search that file and every chunk it imports for `transformers`, `onnxruntime` and `ort-wasm`. There must be **no** matches.
   - Then do the same for `web/dist/captions.html` and confirm the engine's worker file is referenced there.
   - Report the file names and sizes of the home page's JS before and after your change.
6. **`web/dist` contains exactly one `ort-wasm-simd-threaded.jsep-*.wasm`,** under 25 MiB.
7. **Manual test in Chrome,** visible and not minimised, using the dev server `npm --prefix web run dev` (port 5173) at `http://localhost:5173/captions.html`. Use the owner's test video `C:\Users\Sauvraneel Paul\Downloads\Tesla flying car expectation vs reality.mp4`.
   - Make captions. Report the time taken, the number of captions, and the **full SRT output** (this video is fine to quote).
   - Edit one caption, download both files, and confirm the edit is in both.
   - Start a second run and cancel it partway. It must return to the pick state, not show an error.
   - Run again without reloading the page. The model must not download again.
   - Check that the home page `http://localhost:5173/` still works: hero, sections, footer link to Captions.
   - Check the page at phone width (375px) for layout breaks.
   - Copy any console errors.
8. `git status` must show only files you're allowed to change.

## The report

Reply with these sections, in order:

1. **Files changed or added,** one line each with the reason.
2. **Which of the allowed fixes in step 5.3 you used,** and why.
3. **Output of checks 1–6:** exact lines, test counts, and file names and sizes.
4. **Manual test results** from check 7, including the full SRT and any console errors.
5. **Everything that didn't match this prompt,** everything you couldn't verify, and anything you noticed but didn't fix.
6. **Your commits** (`git log --oneline main..HEAD`).
