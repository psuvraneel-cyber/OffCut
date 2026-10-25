<div align="center">

<img src="web/public/favicon.svg" width="88" alt="Offcut logo" />

# Offcut

**Long videos in. Captioned Reels out. Nothing leaves your device.**

A free, open-source AI video clipper that runs entirely in your browser.
No uploads, no account, no watermark.

![Status](https://img.shields.io/badge/status-building%20in%20public-7a4dff?style=flat-square)
![Price](https://img.shields.io/badge/price-free-d77bff?style=flat-square)
![Privacy](https://img.shields.io/badge/uploads-0%20bytes-6fe3ff?style=flat-square&labelColor=120b24)
![Stack](https://img.shields.io/badge/React%2019-Vite%208-c9b8ff?style=flat-square&labelColor=120b24)

</div>

---

## ✂️ What is Offcut?

Tools like OpusClip turn a podcast or stream into short vertical clips, but they make you **upload your video** to their servers and pay a monthly fee to export without a watermark.

Offcut does the same job **inside your browser tab**. The AI runs on your own computer, so your video never touches a server. There's nothing for us to pay for, so it stays free.

> 🚧 **Early days.** The website and backend are live in this repo. The clipping tool is being built one step at a time, in public, on Instagram.

## 🎬 How it works

Seven steps, all on your device:

| # | Step | What happens | Tech |
|:-:|---|---|---|
| 01 | **Drop in a long video** | The file is read straight from your disk | MP4 · MOV · WebM |
| 02 | **Audio split out** | The soundtrack is pulled from the video | Demux |
| 03 | **Transcribed on your device** | Every word, with exact timestamps | Whisper · WebGPU |
| 04 | **Best moments picked** | Hooks and punchlines scored into 15–60 s clips | Clip scoring |
| 05 | **Reframed to vertical** | Face tracking keeps the speaker in a 9:16 shot | Face tracking |
| 06 | **Word-by-word captions** | Captions light up as each word is spoken | Captions |
| 07 | **Exported** | Encoded in the browser, saved to your downloads | WebCodecs |

**Bytes of video uploaded: `0`**

## 🔒 Privacy, by design

- **Your video never leaves your device.** There's no upload endpoint at all.
- **No cookies, no tracking.** The backend never stores IP addresses. Visits are counted with cookie-less Cloudflare Web Analytics.
- **Anonymous by default.** Feature votes use a random browser ID; the clip counter is just a total.
- **Your email only with consent.** The waitlist stores an address only if you tick the box.
- AI models download once from Hugging Face's CDN and are cached by your browser.

## 🗳️ You pick what gets built

The site has a public roadmap where anyone can upvote the next feature. Ideas so far:

- Hindi & Hinglish captions
- More caption styles
- Export all clips at once
- Auto B-roll suggestions
- Desktop app

## 🧱 Tech stack

| Layer | Tools |
|---|---|
| **Website** | React 19, TypeScript, Vite 8, GSAP + ScrollTrigger, Lenis, Three.js |
| **In-browser AI** *(in progress)* | Whisper via Transformers.js (WebGPU, WASM fallback), WebCodecs |
| **Backend** | Cloudflare Pages Functions, D1 (SQLite), Turnstile |
| **Hosting** | Cloudflare Pages (free tier) |

Budget: **₹0**. Everything heavy runs on the visitor's device, and everything else fits in free tiers.

## 📁 Repo layout

```
web/          The website (and later the clipping tool)
functions/    API: waitlist, feature votes, clip counter, error reports
migrations/   D1 database schema and seed data
shared/       API types shared by the site and the backend
test/         Backend tests (Vitest + Workers pool)
docs/         Specs and setup guides
```

## 🚀 Run it locally

**Requirements:** Node.js 20+ and npm.

```bash
# 1. Install dependencies
npm install
npm --prefix web install

# 2. Start the website → http://localhost:5173
npm run dev:web
```

**To run the API too** (waitlist, voting):

```bash
# Copy the example env file, then set Cloudflare's Turnstile test secret in it:
#   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
cp .dev.vars.example .dev.vars

# Create the local database
npm run db:migrate:local

# Build the site, then serve it with the API → http://localhost:8788
npm run build:web
npm run dev:api
```

While both are running, the Vite dev server on `:5173` forwards `/api` calls to `:8788`.

**Checks:**

```bash
npm run lint:web       # lint the website
npm run test:api       # backend tests
npm run typecheck:api  # backend types
```

> ⚠️ Use `npm run build:web` locally. The root `npm run build` is for Cloudflare's build and reinstalls `web/node_modules`.

## 💸 How will it stay free?

Later on, a small display ad will appear on the **processing screen**, while you'd be waiting anyway. There may also be an optional "watch an ad to unlock an extra" offer.

Ads will **never** be forced, never block a download, never add a watermark and never get access to your video.

## 📣 Built in public

Every milestone is shared on Instagram as it happens. Follow along: **[@paulsuvraeel](https://www.instagram.com/paulsuvraeel/)**

## 📄 Licence

Offcut is open-source software licensed under the [Apache License 2.0](LICENSE).

You are free to use, modify, and distribute the code, including for commercial purposes, provided you keep the `LICENSE` and `NOTICE` files intact and credit **Suvraneel Paul** as Offcut’s creator.

The name "Offcut" and the Offcut logo are trademarks of Suvraneel Paul and are not covered by this licence: forks and derivative projects must use a different name and branding.

---

<div align="center">
<sub>Made with ✂️ in India · Your video stays yours.</sub>
</div>
