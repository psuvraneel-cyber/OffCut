import { createTranscriber, detectCapabilities } from "../src/index";
import type { CapabilityReport, Device, ModelSize, Progress, Transcript } from "../src/types";

const capabilitiesElement = getElement<HTMLDivElement>("capabilities");
const dropzone = getElement<HTMLDivElement>("dropzone");
const fileInput = getElement<HTMLInputElement>("file-input");
const fileName = getElement<HTMLParagraphElement>("file-name");
const preview = getElement<HTMLVideoElement>("preview");
const modelSelect = getElement<HTMLSelectElement>("model");
const deviceSelect = getElement<HTMLSelectElement>("device");
const languageSelect = getElement<HTMLSelectElement>("language");
const transcribeButton = getElement<HTMLButtonElement>("transcribe");
const cancelButton = getElement<HTMLButtonElement>("cancel");
const clearCacheButton = getElement<HTMLButtonElement>("clear-cache");
const progressStage = getElement<HTMLSpanElement>("progress-stage");
const progressBar = getElement<HTMLProgressElement>("progress");
const elapsedElement = getElement<HTMLSpanElement>("elapsed");
const statusElement = getElement<HTMLParagraphElement>("status");
const transcriptMeta = getElement<HTMLParagraphElement>("transcript-meta");
const transcriptElement = getElement<HTMLDivElement>("transcript");
const statsElement = getElement<HTMLDivElement>("stats");
const downloadButton = getElement<HTMLButtonElement>("download");
const errorElement = getElement<HTMLParagraphElement>("error");

let selectedFile: File | null = null;
let objectUrl: string | null = null;
let currentTranscript: Transcript | null = null;
let currentAbort: AbortController | null = null;
let currentTranscriber: ReturnType<typeof createTranscriber> | null = null;
let wordButtons: HTMLButtonElement[] = [];
let startedAt = 0;
let elapsedTimer: number | null = null;

void initialize();

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    chooseFile(file);
  }
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  const file = event.dataTransfer?.files[0];
  if (file) {
    chooseFile(file);
  }
});

transcribeButton.addEventListener("click", () => {
  void transcribeSelectedFile();
});

cancelButton.addEventListener("click", () => currentAbort?.abort());
clearCacheButton.addEventListener("click", () => {
  void clearModelCache();
});
downloadButton.addEventListener("click", downloadTranscript);
preview.addEventListener("timeupdate", highlightCurrentWord);

async function initialize(): Promise<void> {
  try {
    const capabilities = await detectCapabilities();
    renderCapabilities(capabilities);
  } catch (error) {
    showError(error);
  }
}

function chooseFile(file: File): void {
  selectedFile = file;
  currentTranscript = null;
  fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  transcribeButton.disabled = false;
  downloadButton.disabled = true;
  transcriptMeta.textContent = "No transcript yet.";
  transcriptElement.innerHTML = '<p class="muted">Words will appear here after transcription.</p>';
  statsElement.innerHTML = '<p class="muted">No stats yet.</p>';
  clearError();

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }
  objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  preview.hidden = false;
}

async function transcribeSelectedFile(): Promise<void> {
  if (!selectedFile) {
    return;
  }

  currentAbort?.abort();
  currentAbort = new AbortController();
  currentTranscriber?.dispose();
  currentTranscriber = createTranscriber({
    model: modelSelect.value as ModelSize,
    device: deviceSelect.value as Device,
  });

  setRunning(true);
  clearError();
  currentTranscript = null;
  startedAt = performance.now();
  elapsedTimer = window.setInterval(updateElapsed, 100);
  updateElapsed();

  try {
    const transcript = await currentTranscriber.transcribe(selectedFile, {
      language: languageSelect.value,
      signal: currentAbort.signal,
      onProgress: renderProgress,
    });
    currentTranscript = transcript;
    renderTranscript(transcript);
    statusElement.textContent = "Finished on this device. No media or transcript was uploaded.";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      statusElement.textContent = "Cancelled. The worker was restarted and is ready for another run.";
    } else {
      showError(error);
    }
  } finally {
    setRunning(false);
    if (elapsedTimer !== null) {
      window.clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    currentAbort = null;
  }
}

function renderCapabilities(capabilities: CapabilityReport): void {
  const entries = [
    ["WebGPU", capabilities.webgpu ? "yes" : "no"],
    ["Shader f16", capabilities.shaderF16 ? "yes" : "no"],
    ["WebCodecs audio", capabilities.webcodecsAudio ? "yes" : "no"],
    ["Recommended model", capabilities.recommendedModel],
    ["Recommended device", capabilities.recommendedDevice],
  ];
  capabilitiesElement.innerHTML = entries
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderProgress(progress: Progress): void {
  progressStage.textContent = progress.stage[0].toUpperCase() + progress.stage.slice(1);
  if (progress.stage === "download") {
    const ratio = progress.total > 0 ? progress.loaded / progress.total : 0;
    progressBar.value = Math.min(1, Math.max(0, ratio));
    statusElement.textContent = `Downloading ${progress.file}… ${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`;
  } else if (progress.stage === "load") {
    progressBar.value = 0;
    statusElement.textContent = "Loading and warming the Whisper model…";
  } else {
    progressBar.value = progress.duration > 0 ? progress.seconds / progress.duration : 0;
    statusElement.textContent = `${progress.stage === "decode" ? "Extracting audio" : "Recognising speech"} at ${progress.seconds.toFixed(1)} / ${progress.duration.toFixed(1)} s`;
  }
}

function renderTranscript(transcript: Transcript): void {
  transcriptMeta.textContent = `${transcript.language} · ${transcript.granularity}-level · ${transcript.words.length} words · ${transcript.duration.toFixed(2)} seconds`;
  transcriptElement.innerHTML = "";
  wordButtons = transcript.words.map((word, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word";
    button.textContent = word.text;
    button.title = `${word.start.toFixed(2)}–${word.end.toFixed(2)} seconds`;
    button.addEventListener("click", () => {
      preview.currentTime = word.start;
      void preview.play();
      setActiveWord(index);
    });
    transcriptElement.append(button, document.createTextNode(" "));
    return button;
  });
  renderStats(transcript);
  downloadButton.disabled = false;
}

function renderStats(transcript: Transcript): void {
  const entries = [
    ["Model", transcript.stats.model],
    ["Device", transcript.stats.device],
    ["Dtype", transcript.stats.dtype],
    ["Load", formatMs(transcript.stats.loadMs)],
    ["Decode", formatMs(transcript.stats.decodeMs)],
    ["Transcribe", formatMs(transcript.stats.transcribeMs)],
    ["Real-time factor", `${transcript.stats.realTimeFactor.toFixed(2)}×`],
  ];
  statsElement.innerHTML = entries
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function highlightCurrentWord(): void {
  if (!currentTranscript || currentTranscript.words.length === 0) {
    return;
  }

  const time = preview.currentTime;
  let low = 0;
  let high = currentTranscript.words.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const word = currentTranscript.words[middle];
    if (time < word.start) {
      high = middle - 1;
    } else if (time > word.end) {
      low = middle + 1;
    } else {
      match = middle;
      break;
    }
  }
  setActiveWord(match);
}

function setActiveWord(index: number): void {
  wordButtons.forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === index));
}

async function clearModelCache(): Promise<void> {
  try {
    const deleted = typeof caches !== "undefined" ? await caches.delete("transformers-cache") : false;
    statusElement.textContent = deleted ? "Transformers.js model cache cleared." : "No Transformers.js cache was found.";
  } catch (error) {
    showError(error);
  }
}

function downloadTranscript(): void {
  if (!currentTranscript) {
    return;
  }
  const blob = new Blob([JSON.stringify(currentTranscript, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "offcut-transcript.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function setRunning(running: boolean): void {
  transcribeButton.disabled = running || selectedFile === null;
  cancelButton.disabled = !running;
  modelSelect.disabled = running;
  deviceSelect.disabled = running;
  languageSelect.disabled = running;
}

function updateElapsed(): void {
  elapsedElement.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
}

function showError(error: unknown): void {
  errorElement.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function clearError(): void {
  errorElement.textContent = "";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMs(value: number): string {
  return `${(value / 1000).toFixed(2)} s`;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing demo element #${id}`);
  }
  return element as T;
}
