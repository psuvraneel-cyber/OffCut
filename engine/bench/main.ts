import { createTranscriber } from "../src/index";
import { resampleMono } from "../src/audio/resample";
import { charErrors, wordErrors, type CharErrors, type WordErrors } from "./wer";
import type { Progress, TranscribeOptions, Transcript } from "../src/types";

interface ManifestSample {
  sample_id: string;
  category: string;
  language: string;
  audio_standardized_path: string;
  audio_original_path?: string;
  transcript_reference_path: string;
  duration_seconds: number;
}

interface EvalItem {
  id: string;
  category: string;
  language: string;
  audioUrl: string;
  referenceText: string;
  durationSeconds: number;
  isStitchedSilence?: boolean;
  silenceSpeechDuration?: number;
  customBlob?: Blob;
}

interface SampleBenchResult {
  runIndex: number;
  id: string;
  category: string;
  language: string;
  duration: number;
  detectedLanguage: string;
  wordErrors: WordErrors;
  charErrors: CharErrors;
  deletionRate: number;
  maxGapSeconds: number;
  wordsInSilence: number;
  wallTimeMs: number;
  rtf: number;
  stats: Transcript["stats"];
  hypothesisText: string;
}

interface BenchResultsPayload {
  label: string;
  model: "tiny" | "base";
  device: "webgpu" | "wasm";
  vad: boolean;
  set: "short" | "long" | "all";
  runs: number;
  timestamp: string;
  summaryTableMd: string;
  results: SampleBenchResult[];
}

function float32ToWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function decodeBlobTo16kMono(blob: Blob): Promise<Float32Array> {
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
    sampleRate: 16000,
  });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channel0 = audioBuffer.getChannelData(0);
    if (audioBuffer.sampleRate === 16000) {
      return new Float32Array(channel0);
    }
    return resampleMono(channel0, audioBuffer.sampleRate, 16000);
  } finally {
    await audioCtx.close();
  }
}

function calculateMaxGap(
  words: readonly { start: number; end: number }[],
  speechSegments?: readonly { start: number; end: number }[],
): number {
  if (words.length < 2) return 0;
  let maxGap = 0;
  for (let i = 1; i < words.length; i++) {
    const gapStart = words[i - 1].end;
    const gapEnd = words[i].start;
    if (gapEnd <= gapStart) continue;

    if (speechSegments && speechSegments.length > 0) {
      let speechGap = 0;
      for (const seg of speechSegments) {
        const overlapStart = Math.max(gapStart, seg.start);
        const overlapEnd = Math.min(gapEnd, seg.end);
        if (overlapEnd > overlapStart) {
          speechGap += overlapEnd - overlapStart;
        }
      }
      if (speechGap > maxGap) {
        maxGap = speechGap;
      }
    } else {
      const gap = gapEnd - gapStart;
      if (gap > maxGap) {
        maxGap = gap;
      }
    }
  }
  return maxGap;
}

function countWordsInSilence(words: readonly { start: number; end: number }[], speechDuration: number): number {
  let count = 0;
  const speechStart = 10.0;
  const speechEnd = 10.0 + speechDuration;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid < speechStart || mid > speechEnd) {
      count++;
    }
  }
  return count;
}

function formatPercent(value: number): string {
  return (value * 100).toFixed(2) + "%";
}

function generateSummaryMarkdown(payload: Omit<BenchResultsPayload, "summaryTableMd">): string {
  const lines: string[] = [];
  lines.push(`| Config | Model: ${payload.model} | Device: ${payload.device} | VAD: ${payload.vad ? "on" : "off"} | Set: ${payload.set} | Runs: ${payload.runs} |`);
  lines.push("|---|---|---|---|---|---|");
  lines.push("");
  lines.push("| Sample ID | Lang | Dur (s) | Ref Words | Hyp Words | WER | S | D | I | Del Rate | CER | Max Gap (s) | Sil Words | Wall (s) | RTF | VAD | Win | Retry |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");

  for (const r of payload.results) {
    const dur = r.duration.toFixed(1);
    const wer = formatPercent(r.wordErrors.wer);
    const del = formatPercent(r.deletionRate);
    const cer = formatPercent(r.charErrors.cer);
    const gap = r.maxGapSeconds.toFixed(2);
    const wall = (r.wallTimeMs / 1000).toFixed(1);
    const rtf = r.rtf.toFixed(3);
    const statsAny = r.stats as unknown as { vad?: string; windows?: number; retriedWindows?: number };
    const vadType = statsAny?.vad ?? (payload.vad ? "silero" : "off");
    const win = statsAny?.windows ?? 1;
    const retry = statsAny?.retriedWindows ?? 0;

    lines.push(
      `| ${r.id} | ${r.language} | ${dur} | ${r.wordErrors.referenceWords} | ${r.wordErrors.referenceWords - r.wordErrors.deletions + r.wordErrors.insertions} | ${wer} | ${r.wordErrors.substitutions} | ${r.wordErrors.deletions} | ${r.wordErrors.insertions} | ${del} | ${cer} | ${gap} | ${r.wordsInSilence} | ${wall} | ${rtf} | ${vadType} | ${win} | ${retry} |`
    );
  }

  // Summary by category
  const categories = Array.from(new Set(payload.results.map((r) => r.category)));
  lines.push("");
  lines.push("### Category Averages");
  lines.push("| Category | Samples | Mean WER | Mean Del Rate | Mean CER | Mean RTF | Total Wall (s) |");
  lines.push("|---|---|---|---|---|---|---|");

  for (const cat of categories) {
    const items = payload.results.filter((r) => r.category === cat);
    const meanWer = items.reduce((acc, r) => acc + r.wordErrors.wer, 0) / items.length;
    const meanDel = items.reduce((acc, r) => acc + r.deletionRate, 0) / items.length;
    const meanCer = items.reduce((acc, r) => acc + r.charErrors.cer, 0) / items.length;
    const meanRtf = items.reduce((acc, r) => acc + r.rtf, 0) / items.length;
    const totalWall = (items.reduce((acc, r) => acc + r.wallTimeMs, 0) / 1000).toFixed(1);
    lines.push(`| ${cat} | ${items.length} | ${formatPercent(meanWer)} | ${formatPercent(meanDel)} | ${formatPercent(meanCer)} | ${meanRtf.toFixed(3)} | ${totalWall} |`);
  }

  return lines.join("\n");
}

async function runBenchmark() {
  const urlParams = new URLSearchParams(window.location.search);
  const model = (urlParams.get("model") ?? "tiny") as "tiny" | "base";
  const device = (urlParams.get("device") ?? (("gpu" in navigator) ? "webgpu" : "wasm")) as "webgpu" | "wasm";
  const vad = (urlParams.get("vad") ?? "off") === "on";
  const setChoice = (urlParams.get("set") ?? "short") as "short" | "long" | "all";
  const runs = Math.max(1, parseInt(urlParams.get("runs") ?? "1", 10));
  const label = urlParams.get("label") ?? "baseline";

  const statModel = document.getElementById("stat-model");
  const statVad = document.getElementById("stat-vad");
  const statAudioTime = document.getElementById("stat-audio-time");
  const statRtf = document.getElementById("stat-rtf");
  const statusTitle = document.getElementById("status-title");
  const statusBox = document.getElementById("status-box");
  const progressBar = document.getElementById("progress-bar");
  const tbody = document.getElementById("results-tbody");
  const summaryTables = document.getElementById("summary-tables");

  if (statModel) statModel.textContent = `${model} (${device})`;
  if (statVad) statVad.textContent = vad ? "Silero VAD (on)" : "Fixed Windows (off)";

  function logStatus(title: string, detail: string, pct = 0) {
    if (statusTitle) statusTitle.textContent = title;
    if (statusBox) statusBox.textContent = detail;
    if (progressBar) progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  logStatus("Loading manifest...", "Fetching /eval/manifest.json");
  const manifestResp = await fetch("/eval/manifest.json");
  if (!manifestResp.ok) throw new Error("Failed to load /eval/manifest.json");
  const manifest = (await manifestResp.json()) as ManifestSample[];

  const refMap = new Map<string, string>();
  for (const s of manifest) {
    const textResp = await fetch(`/eval/${s.transcript_reference_path}`);
    if (textResp.ok) {
      refMap.set(s.sample_id, await textResp.text());
    }
  }

  const longRefResp = await fetch("/eval/derived/EN_PODCAST_FULL_reference.txt");
  let longRefText = "";
  if (longRefResp.ok) {
    longRefText = await longRefResp.text();
  }

  // Build evaluation queue
  const items: EvalItem[] = [];

  if (setChoice === "short" || setChoice === "all") {
    for (const s of manifest) {
      const ref = refMap.get(s.sample_id) ?? "";
      const audioUrl = `/eval/${s.audio_standardized_path}`;
      if (s.category === "02_hindi" || s.category === "03_hinglish") {
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "auto",
          audioUrl,
          referenceText: ref,
          durationSeconds: s.duration_seconds,
        });
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "hi",
          audioUrl,
          referenceText: ref,
          durationSeconds: s.duration_seconds,
        });
      } else {
        items.push({
          id: s.sample_id,
          category: s.category,
          language: "en",
          audioUrl,
          referenceText: ref,
          durationSeconds: s.duration_seconds,
        });
      }
    }
  }

  if (setChoice === "long" || setChoice === "all") {
    // 1. Full NPR episode
    items.push({
      id: "EN_PODCAST_FULL",
      category: "01_english_podcast",
      language: "en",
      audioUrl: "/eval/01_english_podcast/audio/original/EN_PODCAST_001_full_episode.mp3",
      referenceText: longRefText,
      durationSeconds: 1704.6,
    });

    // 2. 10m manual loop
    const sentence = "This is a local off-cut transcription test. The video never leaves this computer. We are checking word time stamps, cancellation, and model caching.";
    const sentencePartial = "This is a local off-cut transcription test.";
    const repeats10m = Array(55).fill(sentence).join(" ") + " " + sentencePartial;
    items.push({
      id: "MANUAL_ENGLISH_10M",
      category: "01_english_podcast",
      language: "en",
      audioUrl: "/manual-english-10m.wav",
      referenceText: repeats10m,
      durationSeconds: 600.0,
    });

    // 3. STITCH_HINGLISH (in-memory)
    logStatus("Building STITCH_HINGLISH...", "Fetching and concatenating CoSHE clips in memory");
    const coshe1Blob = await (await fetch("/eval/03_hinglish/audio/standardized/HINGLISH_COSHE_001.wav")).blob();
    const coshe2Blob = await (await fetch("/eval/03_hinglish/audio/standardized/HINGLISH_COSHE_002.wav")).blob();
    const coshe3Blob = await (await fetch("/eval/03_hinglish/audio/standardized/HINGLISH_COSHE_003.wav")).blob();

    const pcm1 = await decodeBlobTo16kMono(coshe1Blob);
    const pcm2 = await decodeBlobTo16kMono(coshe2Blob);
    const pcm3 = await decodeBlobTo16kMono(coshe3Blob);
    const silence15s = new Float32Array(Math.round(1.5 * 16000));

    const totalLen = pcm1.length + silence15s.length + pcm2.length + silence15s.length + pcm3.length;
    const stitchedPcm = new Float32Array(totalLen);
    let offset = 0;
    stitchedPcm.set(pcm1, offset); offset += pcm1.length;
    stitchedPcm.set(silence15s, offset); offset += silence15s.length;
    stitchedPcm.set(pcm2, offset); offset += pcm2.length;
    stitchedPcm.set(silence15s, offset); offset += silence15s.length;
    stitchedPcm.set(pcm3, offset);

    const stitchedHinglishBlob = float32ToWavBlob(stitchedPcm, 16000);
    const stitchedRef = [
      refMap.get("HINGLISH_COSHE_001") ?? "",
      refMap.get("HINGLISH_COSHE_002") ?? "",
      refMap.get("HINGLISH_COSHE_003") ?? "",
    ].join(" ");
    const stitchedDuration = totalLen / 16000;

    items.push({
      id: "STITCH_HINGLISH",
      category: "03_hinglish",
      language: "auto",
      audioUrl: "memory:STITCH_HINGLISH",
      referenceText: stitchedRef,
      durationSeconds: stitchedDuration,
      customBlob: stitchedHinglishBlob,
    });
    items.push({
      id: "STITCH_HINGLISH",
      category: "03_hinglish",
      language: "hi",
      audioUrl: "memory:STITCH_HINGLISH",
      referenceText: stitchedRef,
      durationSeconds: stitchedDuration,
      customBlob: stitchedHinglishBlob,
    });

    // 4. STITCH_SILENCE (in-memory)
    logStatus("Building STITCH_SILENCE...", "Synthesizing 10s silence + VLOG_DRIVE_003 + 10s silence in memory");
    const vlog3Blob = await (await fetch("/eval/04_noisy_vlog/audio/standardized/VLOG_DRIVE_003.wav")).blob();
    const vlog3Pcm = await decodeBlobTo16kMono(vlog3Blob);
    const silence10s = new Float32Array(10 * 16000);

    const stitchSilenceLen = silence10s.length + vlog3Pcm.length + silence10s.length;
    const stitchSilencePcm = new Float32Array(stitchSilenceLen);
    let sOffset = 0;
    stitchSilencePcm.set(silence10s, sOffset); sOffset += silence10s.length;
    stitchSilencePcm.set(vlog3Pcm, sOffset); sOffset += vlog3Pcm.length;
    stitchSilencePcm.set(silence10s, sOffset);

    const stitchSilenceBlob = float32ToWavBlob(stitchSilencePcm, 16000);
    const vlog3Ref = refMap.get("VLOG_DRIVE_003") ?? "";
    const vlog3Dur = vlog3Pcm.length / 16000;

    items.push({
      id: "STITCH_SILENCE",
      category: "04_noisy_vlog",
      language: "en",
      audioUrl: "memory:STITCH_SILENCE",
      referenceText: vlog3Ref,
      durationSeconds: stitchSilenceLen / 16000,
      isStitchedSilence: true,
      silenceSpeechDuration: vlog3Dur,
      customBlob: stitchSilenceBlob,
    });
  }

  const results: SampleBenchResult[] = [];
  const totalSteps = runs * items.length;
  let currentStep = 0;
  let totalEvaluatedSeconds = 0;
  let totalWallTimeMs = 0;

  for (let runIdx = 1; runIdx <= runs; runIdx++) {
    for (const item of items) {
      currentStep++;
      const stepPct = Math.round(((currentStep - 1) / totalSteps) * 100);
      logStatus(
        `Evaluating (${currentStep}/${totalSteps}): ${item.id} [${item.language}]`,
        `Run ${runIdx}/${runs} | Category: ${item.category} | Duration: ${item.durationSeconds.toFixed(1)}s`,
        stepPct
      );

      let blob: Blob;
      if (item.customBlob) {
        blob = item.customBlob;
      } else {
        const resp = await fetch(item.audioUrl);
        if (!resp.ok) throw new Error(`Failed to fetch audio from ${item.audioUrl}`);
        blob = await resp.blob();
      }

      // Initialize transcriber per evaluation
      const transcriber = createTranscriber({ model, device });
      const t0 = performance.now();

      try {
        const transcribeOpts: TranscribeOptions & { retry?: boolean } = {
          language: item.language,
          onProgress: (prog: Progress) => {
            const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
            const secStr = "seconds" in prog ? `${prog.seconds.toFixed(1)}s / ${item.durationSeconds.toFixed(1)}s` : "";
            logStatus(
              `Evaluating (${currentStep}/${totalSteps}): ${item.id} [${item.language}]`,
              `Stage: ${prog.stage} ${secStr} (${elapsed}s elapsed)`,
              stepPct
            );
          },
        };
        if (vad) {
          transcribeOpts.vad = true;
          if (label === "vad") {
            transcribeOpts.retry = false;
          } else if (label === "vad-retry") {
            transcribeOpts.retry = true;
          }
        } else {
          transcribeOpts.vad = false;
        }

        const transcript = await transcriber.transcribe(blob, transcribeOpts);

        const wallTimeMs = performance.now() - t0;
        totalEvaluatedSeconds += item.durationSeconds;
        totalWallTimeMs += wallTimeMs;

        const hypText = transcript.words.length > 0
          ? transcript.words.map((w) => w.text).join(" ")
          : transcript.segments.map((s) => s.text).join(" ");

        const wErr = wordErrors(item.referenceText, hypText);
        const cErr = charErrors(item.referenceText, hypText);
        const deletionRate = wErr.referenceWords > 0 ? wErr.deletions / wErr.referenceWords : 0;
        const maxGapSeconds = calculateMaxGap(transcript.words, transcript.stats.speechSegments);
        const wordsInSilence = item.isStitchedSilence
          ? countWordsInSilence(transcript.words, item.silenceSpeechDuration ?? 3.34)
          : 0;
        const rtf = (wallTimeMs / 1000) / item.durationSeconds;

        const sampleResult: SampleBenchResult = {
          runIndex: runIdx,
          id: item.id,
          category: item.category,
          language: item.language,
          duration: item.durationSeconds,
          detectedLanguage: transcript.language,
          wordErrors: wErr,
          charErrors: cErr,
          deletionRate,
          maxGapSeconds,
          wordsInSilence,
          wallTimeMs,
          rtf,
          stats: transcript.stats,
          hypothesisText: hypText,
        };

        results.push(sampleResult);

        // Append row to results table
        if (tbody) {
          const tr = document.createElement("tr");
          const werPct = formatPercent(wErr.wer);
          const delPct = formatPercent(deletionRate);
          const cerPct = formatPercent(cErr.cer);
          const werClass = wErr.wer < 0.15 ? "badge-pass" : wErr.wer < 0.4 ? "badge-warn" : "badge-fail";

          tr.innerHTML = `
            <td><strong>${item.id}</strong></td>
            <td>${item.category.replace(/^\d+_/, "")}</td>
            <td>${item.language}</td>
            <td>${item.durationSeconds.toFixed(1)}s</td>
            <td>${wErr.referenceWords}</td>
            <td>${transcript.words.length}</td>
            <td><span class="badge ${werClass}">${werPct}</span></td>
            <td>${wErr.substitutions}/${wErr.deletions}/${wErr.insertions}</td>
            <td>${delPct}</td>
            <td>${cerPct}</td>
            <td>${maxGapSeconds.toFixed(2)}s</td>
            <td>${wordsInSilence > 0 ? `<span class="badge badge-fail">${wordsInSilence}</span>` : "0"}</td>
            <td>${(wallTimeMs / 1000).toFixed(1)}s</td>
            <td>${rtf.toFixed(3)}</td>
            <td>${(transcript.stats as unknown as { vad?: string })?.vad ?? (vad ? "silero" : "off")}</td>
          `;
          tbody.appendChild(tr);
        }

        if (statAudioTime) statAudioTime.textContent = `${totalEvaluatedSeconds.toFixed(1)}s`;
        if (statRtf) statRtf.textContent = `${((totalWallTimeMs / 1000) / totalEvaluatedSeconds).toFixed(3)}x`;
      } finally {
        transcriber.dispose();
      }
    }
  }

  logStatus("Benchmark complete!", "Generating summaries and saving results...", 100);

  const basePayload = {
    label,
    model,
    device,
    vad,
    set: setChoice,
    runs,
    timestamp: new Date().toISOString(),
    results,
  };

  const summaryTableMd = generateSummaryMarkdown(basePayload);
  const fullPayload: BenchResultsPayload = {
    ...basePayload,
    summaryTableMd,
  };

  if (summaryTables) {
    summaryTables.innerHTML = `<pre style="background: rgba(0,0,0,0.4); padding: 16px; border-radius: 6px; overflow-x: auto; color: #e2e8f0;">${summaryTableMd}</pre>`;
  }

  // Expose as window.__benchResults
  (window as unknown as { __benchResults: BenchResultsPayload }).__benchResults = fullPayload;

  // POST results to /eval-results/<label>-<model>-<timestamp>.json
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${label}-${model}-${safeTimestamp}.json`;
  logStatus("Saving results...", `POSTing to /eval-results/${filename}`);

  try {
    const postResp = await fetch(`/eval-results/${filename}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullPayload, null, 2),
    });
    if (postResp.ok) {
      logStatus("Benchmark Finished!", `Saved to asr-evaluation-assets/results/${filename} and updated RESULTS.md`);
    } else {
      logStatus("Benchmark Complete (Save Warning)", `POST returned ${postResp.status}: ${await postResp.text()}`);
    }
  } catch (postErr) {
    logStatus("Benchmark Complete (Save Failed)", String(postErr));
  }
}

// Auto-run if URL query contains any benchmark parameter, or provide trigger
runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  const statusTitle = document.getElementById("status-title");
  const statusBox = document.getElementById("status-box");
  if (statusTitle) statusTitle.textContent = "Benchmark Error";
  if (statusBox) statusBox.textContent = err instanceof Error ? err.stack ?? err.message : String(err);
});
