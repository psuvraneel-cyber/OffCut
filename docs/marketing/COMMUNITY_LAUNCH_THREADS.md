# 📢 Community Launch Threads for Offcut (Transparent & Honest "Build in Public" Edition)

> **Core Philosophy:** Complete transparency builds immense trust on Hacker News, Reddit, and GitHub.
> **Honest Positioning:** Offcut is the open-source, browser-native alternative to OpusClip. **Phase 1 (Whisper WebGPU AI captioning & transcription) is fully functional and live today.** The automated clipping and vertical reframing pipeline is actively being built in public.

---

## 1. 🟠 Hacker News (`Show HN`)

### Submission Title:
```text
Show HN: Offcut – Building an open-source OpusClip in the browser (Captions live)
```

### URL:
```text
https://offcut-ai.pages.dev
```

### Text / First Comment (Post immediately as your top comment):

```text
Hi HN!

I'm building Offcut (https://offcut-ai.pages.dev), an open-source, browser-native alternative to OpusClip that turns long-form videos into captioned short clips without your files ever leaving your device.

To be completely upfront: the full product is still an active work-in-progress. I am building this in public, and today I am releasing **Phase 1: the in-browser AI captioning & transcription engine**.

### Why build this?
Services like OpusClip and Descript are great, but they all share the same cloud architecture: you upload massive 2–4 GB video files, wait in a remote queue, and pay $20–$40/month. For creators with confidential footage, raw recordings, or limited bandwidth, uploading gigabytes just to generate captions and clips is unnecessary overhead.

Modern user hardware (Apple Silicon, RTX cards, and even modern Intel/AMD integrated GPUs) has plenty of compute to run speech models locally via WebGPU.

### What is ready and working today:
- **Client-Side Speech Recognition:** Drop in any video/audio file. It runs quantized OpenAI Whisper models directly on your GPU using `@huggingface/transformers` (v3.8) and ONNX Runtime WebGPU.
- **Client-Side Demuxing:** Instead of bundling an 80MB+ FFmpeg WASM binary that chokes browser memory, we use `mediabunny` for lightweight, streaming audio demuxing directly in the browser.
- **Word-Level Subtitles:** Synchronized subtitle editor with instant `.srt` and `.vtt` export.
- **Zero Server Uploads:** 0 bytes of media ever touch a server. After initial model caching in IndexedDB, it can run completely offline.

### What is currently in development (The Roadmap):
1. **Audio-driven clip scoring:** Identifying sentence boundaries and speech energy to recommend 30–60s hooks.
2. **Auto-reframing to 9:16:** Face and speaker tracking to convert horizontal video into vertical Reels/Shorts.
3. **Animated caption rendering:** Dynamic kinetic typography rendered client-side via WebCodecs.

### Why share now?
I want to battle-test the in-browser Whisper WebGPU inference engine across as many hardware, driver, and OS configurations as possible before layering the clipping heuristics on top.

The project is 100% open source under Apache-2.0:
https://github.com/psuvraneel-cyber/offcut

Try the caption tool live (no signup required):
https://offcut-ai.pages.dev

I'd love feedback on how the local Whisper engine performs on your machine, and ideas on how to approach client-side hook detection!
```

---

## 2. 🔵 Reddit `r/webdev`

### Post Title:
```text
Building an open-source OpusClip in the browser with WebGPU (Phase 1: AI captions is live)
```

### Post Body:

```markdown
Hey r/webdev!

I’m working on **Offcut** (https://offcut-ai.pages.dev), an open-source, client-side alternative to OpusClip.

To be transparent with the community: **the full auto-clipping tool is still in development, but Phase 1 (the in-browser Whisper WebGPU captioning & transcription tool) is fully built and working today.**

### The Goal:
OpusClip charges $20-$40/mo and forces you to upload 3GB+ files to cloud servers. My goal is to do the entire pipeline—demuxing, transcription, hook scoring, 9:16 reframing, and export—100% on the client’s machine with **0 bytes uploaded**.

### How the current engine works:
1. **Demuxing:** Rather than shipping an 80MB `ffmpeg.wasm` blob, I’m using `mediabunny` to demux the audio track from `.mp4`/`.webm`/`.mov` files in a web worker.
2. **Local AI Inference:** Powered by `@huggingface/transformers` v3.8 using the ONNX Runtime WebGPU provider. It loads quantized Whisper models directly onto your local GPU shaders.
3. **Word-Level Timestamps:** Generates synchronized captions and exports clean `.srt` / `.vtt` files instantly.
4. **Static Architecture:** Frontend runs on Vite + React 19 hosted on Cloudflare Pages. Server hosting costs me $0.

### What's next on the roadmap:
- Sentence boundary & hook scoring algorithms to pick the best 30–60s segments
- Face detection for auto-centering speakers in 9:16 vertical video
- WebCodecs video canvas compositor

I’d love for people here to test the live transcription tool on their machines and let me know how WebGPU behaves on your setup:
- **Live Tool:** https://offcut-ai.pages.dev
- **GitHub Repo (Apache 2.0):** https://github.com/psuvraneel-cyber/offcut

All feedback, bug reports, and PRs are deeply appreciated!
```

---

## 3. 🟣 Reddit `r/SideProject`

### Post Title:
```text
I'm building an open-source, in-browser OpusClip alternative (Phase 1: AI Captions is live and free)
```

### Post Body:

```markdown
Hey r/SideProject!

Like many creators, I love the concept of OpusClip (turning long videos into short vertical clips), but I got sick of:
- Uploading 2–4 GB videos over home internet just to test a clip
- 15-minute cloud processing queues
- Monthly subscriptions and watermarks

So I started building **Offcut** (https://offcut-ai.pages.dev) — an open-source AI video clipper that runs entirely inside your browser.

### Full honesty on current progress:
The full product is an active work-in-progress. I’m building it in public and releasing it feature-by-feature:

- ✅ **Ready today (Phase 1):** The AI Captioning Studio. Drop in any video or audio file, and it uses OpenAI's Whisper model running **directly on your GPU via WebGPU** to generate instant word-by-word subtitles and export SRT/VTT. 0 bytes leave your machine.
- 🚧 **In development (Phase 2):** Hook detection, auto-scoring clips, and 9:16 vertical smart reframing.

### Why try it now?
- It's 100% free and open-source (Apache 2.0).
- No accounts, no paywalls, no credits, and zero watermarks.
- You can use the caption tool right now for your editing projects while following along as we build the clipping engine.

- **Try it in your browser:** https://offcut-ai.pages.dev
- **GitHub:** https://github.com/psuvraneel-cyber/offcut

Would love to hear your feedback on the captioning speed and what features you care about most in a clipper!
```

---

## 4. 🎬 Reddit `r/videography` & `r/ContentCreation`

### Post Title:
```text
Building an open-source OpusClip alternative that runs locally in your browser — caption tool is live today (100% free, no watermarks)
```

### Post Body:

```markdown
Hey everyone,

I edit video and was frustrated by how every AI clipping and subtitle tool locks you into a $30/month subscription, puts watermarks on exports, and makes you upload multi-gigabyte footage to their servers.

I'm building an open-source tool called **Offcut** to do this locally in your browser:
👉 https://offcut-ai.pages.dev

### Transparent status update:
The long-term goal is a full auto-clipper (like an open-source OpusClip). Right now, **the AI captioning tool is live and ready to use:**

- **0 Bytes Uploaded:** It runs OpenAI's Whisper model locally on your computer's GPU using WebGPU. Your unreleased footage never gets uploaded to any cloud server.
- **Accurate Subtitles:** Generates word-level timestamps with instant `.srt` and `.vtt` export to drop straight into Premiere, DaVinci, or CapCut.
- **No Watermarks, No Subscriptions:** 100% free and open-source under Apache 2.0.

If you just need fast, private subtitles without paying for Descript or uploading to third-party servers, you can use it right now. The auto-clipping features are being built in public next!
```
