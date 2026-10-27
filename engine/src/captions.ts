import type { Word } from "./types";

export const CAPTION_CONSTANTS = {
  maxCharsPerLine: 32, // short lines read well on a phone in a vertical Reel
  maxLines: 2,
  maxCueSeconds: 5,
  maxGapSeconds: 1.0, // a pause longer than this starts a new caption
  minCueSeconds: 0.7,
} as const;

export type CaptionPacing = "viral" | "balanced" | "subtitle";

export interface CaptionOptions extends Partial<typeof CAPTION_CONSTANTS> {
  includeSoundCues?: boolean; // default false
  pacing?: CaptionPacing;
  maxWordsPerCue?: number;
}

export const PACING_PRESETS: Record<
  CaptionPacing,
  {
    maxCharsPerLine: number;
    maxLines: number;
    maxCueSeconds: number;
    maxGapSeconds: number;
    minCueSeconds: number;
    maxWordsPerCue: number;
  }
> = {
  viral: {
    maxCharsPerLine: 18,
    maxLines: 1,
    maxCueSeconds: 1.8,
    maxGapSeconds: 0.6,
    minCueSeconds: 0.35,
    maxWordsPerCue: 3,
  },
  balanced: {
    maxCharsPerLine: 28,
    maxLines: 2,
    maxCueSeconds: 3.2,
    maxGapSeconds: 0.8,
    minCueSeconds: 0.5,
    maxWordsPerCue: 6,
  },
  subtitle: {
    maxCharsPerLine: 32,
    maxLines: 2,
    maxCueSeconds: 5.0,
    maxGapSeconds: 1.0,
    minCueSeconds: 0.7,
    maxWordsPerCue: 14,
  },
};

export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

// Sentence boundary marks: Latin (. ? !) and Devanagari Hindi Purna Viram (।) and Deergh Viram (॥)
const SENTENCE_END_REGEX = /[.?!।॥]$/;

function wrapLines(words: readonly string[], maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxCharsPerLine) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function canFitInCaption(
  words: readonly Word[],
  maxLines: number,
  maxCharsPerLine: number,
): boolean {
  if (words.length <= 1) {
    return true;
  }
  const lines = wrapLines(
    words.map((w) => w.text),
    maxCharsPerLine,
  );
  if (lines.length > maxLines) {
    return false;
  }
  for (const line of lines) {
    if (line.length > maxCharsPerLine) {
      return false;
    }
  }
  return true;
}

export function buildCaptionCues(
  words: readonly Word[],
  options?: CaptionOptions,
): CaptionCue[] {
  const pacingConfig = options?.pacing ? PACING_PRESETS[options.pacing] : undefined;

  const maxCharsPerLine =
    options?.maxCharsPerLine ?? pacingConfig?.maxCharsPerLine ?? CAPTION_CONSTANTS.maxCharsPerLine;
  const maxLines = options?.maxLines ?? pacingConfig?.maxLines ?? CAPTION_CONSTANTS.maxLines;
  const maxCueSeconds =
    options?.maxCueSeconds ?? pacingConfig?.maxCueSeconds ?? CAPTION_CONSTANTS.maxCueSeconds;
  const maxGapSeconds =
    options?.maxGapSeconds ?? pacingConfig?.maxGapSeconds ?? CAPTION_CONSTANTS.maxGapSeconds;
  const minCueSeconds =
    options?.minCueSeconds ?? pacingConfig?.minCueSeconds ?? CAPTION_CONSTANTS.minCueSeconds;
  const maxWordsPerCue =
    options?.maxWordsPerCue ?? pacingConfig?.maxWordsPerCue ?? Infinity;
  const includeSoundCues = options?.includeSoundCues ?? false;

  // 1. Drop words with kind === "cue" unless includeSoundCues is true. Drop words whose trimmed text is empty.
  const filteredWords: Word[] = [];
  for (const w of words) {
    if (!includeSoundCues && w.kind === "cue") {
      continue;
    }
    const trimmed = w.text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    filteredWords.push({
      ...w,
      text: trimmed,
      start: Math.max(0, w.start),
      end: Math.max(0, w.end),
    });
  }

  if (filteredWords.length === 0) {
    return [];
  }

  // 2. Walk the words in time order and group them into captions.
  const groups: Word[][] = [];
  let currentGroup: Word[] = [];

  for (const word of filteredWords) {
    if (currentGroup.length === 0) {
      currentGroup.push(word);
      continue;
    }

    const previous = currentGroup[currentGroup.length - 1];
    const candidateGroup = [...currentGroup, word];

    const pauseTooLong = word.start - previous.end > maxGapSeconds;
    const durationTooLong = word.end - currentGroup[0].start > maxCueSeconds;
    const sentenceEnded = SENTENCE_END_REGEX.test(previous.text);
    const doesNotFit = !canFitInCaption(candidateGroup, maxLines, maxCharsPerLine);
    const wordsCountTooHigh = candidateGroup.length > maxWordsPerCue;

    if (pauseTooLong || durationTooLong || sentenceEnded || doesNotFit || wordsCountTooHigh) {
      groups.push(currentGroup);
      currentGroup = [word];
    } else {
      currentGroup.push(word);
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  // 3. Timing and text line wrapping
  const cues: CaptionCue[] = groups.map((group) => {
    const start = Math.max(0, group[0].start);
    const end = Math.max(start, group[group.length - 1].end);
    const text = wrapLines(
      group.map((w) => w.text),
      maxCharsPerLine,
    ).join("\n");
    return { start, end, text };
  });

  // Ensure starts never decrease
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].start) {
      cues[i].start = cues[i - 1].start;
    }
    if (cues[i].end < cues[i].start) {
      cues[i].end = cues[i].start;
    }
  }

  // 4. Extend each caption's end to at least start + minCueSeconds, but never past the next caption's start.
  // Captions never overlap.
  for (let i = 0; i < cues.length; i++) {
    const current = cues[i];
    const nextStart = i + 1 < cues.length ? cues[i + 1].start : Infinity;

    let targetEnd = Math.max(current.end, current.start + minCueSeconds);
    if (targetEnd > nextStart) {
      targetEnd = nextStart;
    }
    if (current.end > nextStart) {
      targetEnd = nextStart;
    }

    current.end = Math.max(current.start, targetEnd);
  }

  return cues;
}

function formatTimestampSrt(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const mmm = String(ms).padStart(3, "0");

  return `${hh}:${mm}:${ss},${mmm}`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  if (cues.length === 0) {
    return "";
  }
  return cues
    .map((cue, index) => {
      const num = index + 1;
      const start = formatTimestampSrt(cue.start);
      const end = formatTimestampSrt(cue.end);
      const text = cue.text.replace(/\r?\n/g, "\r\n");
      return `${num}\r\n${start} --> ${end}\r\n${text}\r\n\r\n`;
    })
    .join("");
}

function formatTimestampVtt(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalMs = Math.round(clamped * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const mmm = String(ms).padStart(3, "0");

  return `${hh}:${mm}:${ss}.${mmm}`;
}

function escapeVtt(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("-->", "→")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\r\n/g, "\n");
}

export function toVtt(cues: readonly CaptionCue[]): string {
  if (cues.length === 0) {
    return "WEBVTT\n";
  }
  const cueBlocks = cues.map((cue) => {
    const start = formatTimestampVtt(cue.start);
    const end = formatTimestampVtt(cue.end);
    const text = escapeVtt(cue.text);
    return `${start} --> ${end}\n${text}\n\n`;
  });
  return `WEBVTT\n\n${cueBlocks.join("")}`;
}
