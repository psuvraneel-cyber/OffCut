import type { CaptionLanguage, WindowTranscript } from "../types";
import type { SpeechSegment } from "./vad";
import { countForeignScriptWords, isWordAllowedInLanguage } from "./script";

export const RETRY_CONSTANTS = {
  minSpeechForCheckSeconds: 5,
  minWordsPerSpeechSecond: 0.8,
  edgeGapSeconds: 4,
  minRepeats: 4,
  // tiny on WASM (q8) looped a 7-word phrase, so loops are searched up to 12 words.
  maxPhraseLength: 12,
  maxJunkWordRatio: 0.3,
  // The longest real word in the test-set references is 19 characters; runaway output reached 296.
  maxWordCharacters: 40,
  // Skipped speech shows up as a few words stretched across it ("Why" lasting 3.4 s), not as a gap.
  // Each word counts as covering at most this long, plus padding on both sides.
  // In the measured case the skipped stretch added up to about 2.6 s with these settings.
  maxWordSeconds: 1.0,
  coverPaddingSeconds: 0.3,
  maxUncoveredSpeechSeconds: 2,
} as const;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function characterCount(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) {
    count++;
  }
  return count;
}

export type AssessmentReason =
  | "too_few_words"
  | "stopped_early"
  | "started_late"
  | "repetition_loop"
  | "junk_output"
  | "foreign_script"
  | "skipped_speech";

export interface WindowAssessment {
  flagged: boolean;
  reason?: AssessmentReason;
  speechSeconds: number;
  flaggedRegion?: { start: number; end: number };
}

export function normalizeToken(text: string): string {
  return text.replace(/\uFFFD/g, "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

// A word with no letters or digits ("-", "- - - -", "...") or an impossibly long one is never speech.
export function isJunkWord(text: string, language: CaptionLanguage = "auto"): boolean {
  if (text.includes("\uFFFD")) {
    return true;
  }
  return normalizeToken(text) === "" ||
    characterCount(text) > RETRY_CONSTANTS.maxWordCharacters ||
    !isWordAllowedInLanguage(text, language);
}

export function removeJunkWords<T extends { text: string; kind?: string }>(
  words: readonly T[],
  language: CaptionLanguage = "auto",
): T[] {
  return words.filter((word) => {
    if (word.text.includes("\uFFFD")) {
      return false;
    }
    return word.kind === "cue" || !isJunkWord(word.text, language);
  });
}

// Keeps the first copy of any 1–maxPhraseLength word phrase repeated minRepeats or more times in a row.
export function removeRepetitionLoops<T extends { text: string; kind?: string }>(
  words: readonly T[],
  minRepeats = RETRY_CONSTANTS.minRepeats,
  maxPhraseLength = RETRY_CONSTANTS.maxPhraseLength,
): T[] {
  const tokens = words.map((word) => normalizeToken(word.text) || word.text.trim().toLowerCase());
  const kept: T[] = [];
  let i = 0;

  while (i < words.length) {
    if (words[i].kind === "cue") {
      kept.push(words[i]);
      i++;
      continue;
    }

    let bestSpan = 0;
    let bestLength = 0;
    for (let length = 1; length <= maxPhraseLength && i + length <= words.length; length++) {
      if (words.slice(i, i + length).some((w) => w.kind === "cue")) {
        continue;
      }
      let repeats = 1;
      while (
        i + (repeats + 1) * length <= words.length &&
        !words.slice(i + repeats * length, i + (repeats + 1) * length).some((w) => w.kind === "cue") &&
        tokens.slice(i + repeats * length, i + (repeats + 1) * length).join(" ") ===
          tokens.slice(i, i + length).join(" ")
      ) {
        repeats++;
      }
      if (repeats >= minRepeats && repeats * length > bestSpan) {
        bestSpan = repeats * length;
        bestLength = length;
      }
    }

    if (bestSpan > 0) {
      kept.push(...words.slice(i, i + bestLength));
      i += bestSpan;
    } else {
      kept.push(words[i]);
      i++;
    }
  }

  return kept;
}

// Seconds of detected speech between the first and last word that no normal-length word covers.
// A word counts as covering at most maxWordSeconds from its start, so words stretched over skipped
// speech don't hide it. Speech before the first or after the last word is "started late"/"stopped early".
export function uncoveredSpeech(
  words: readonly { start: number; end: number }[],
  speech: readonly SpeechSegment[],
  constants: Partial<typeof RETRY_CONSTANTS> = {},
): { seconds: number; start: number; end: number } {
  const maxWord = constants.maxWordSeconds ?? RETRY_CONSTANTS.maxWordSeconds;
  const padding = constants.coverPaddingSeconds ?? RETRY_CONSTANTS.coverPaddingSeconds;

  const covered: SpeechSegment[] = [];
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    const start = word.start - padding;
    const end = Math.min(word.end, word.start + maxWord) + padding;
    const last = covered[covered.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      covered.push({ start, end });
    }
  }

  if (words.length === 0) {
    return { seconds: 0, start: 0, end: 0 };
  }
  const from = Math.min(...words.map((word) => word.start));
  const to = Math.max(...words.map((word) => word.end));

  let seconds = 0;
  let first = Infinity;
  let lastEnd = -Infinity;
  for (const unclipped of speech) {
    const segment = { start: Math.max(unclipped.start, from), end: Math.min(unclipped.end, to) };
    if (segment.end <= segment.start) {
      continue;
    }
    let cursor = segment.start;
    for (const cover of covered) {
      if (cover.end <= cursor || cover.start >= segment.end) {
        continue;
      }
      if (cover.start > cursor) {
        seconds += cover.start - cursor;
        first = Math.min(first, cursor);
        lastEnd = Math.max(lastEnd, cover.start);
      }
      cursor = Math.max(cursor, cover.end);
      if (cursor >= segment.end) {
        break;
      }
    }
    if (cursor < segment.end) {
      seconds += segment.end - cursor;
      first = Math.min(first, cursor);
      lastEnd = Math.max(lastEnd, segment.end);
    }
  }

  return seconds > 0 ? { seconds, start: first, end: lastEnd } : { seconds: 0, start: 0, end: 0 };
}

export function countJunkWords(words: readonly { text: string }[]): number {
  return words.filter((word) => isJunkWord(word.text)).length;
}

export function hasRepetitionLoop(
  tokens: readonly string[],
  minRepeats = RETRY_CONSTANTS.minRepeats,
  maxPhraseLength = RETRY_CONSTANTS.maxPhraseLength,
): boolean {
  if (tokens.length < minRepeats) {
    return false;
  }

  for (let L = 1; L <= maxPhraseLength; L++) {
    const requiredLen = L * minRepeats;
    if (tokens.length < requiredLen) {
      continue;
    }

    for (let i = 0; i <= tokens.length - requiredLen; i++) {
      let isRepeat = true;
      for (let k = 0; k < requiredLen; k++) {
        if (tokens[i + k] !== tokens[i + (k % L)]) {
          isRepeat = false;
          break;
        }
      }
      if (isRepeat) {
        return true;
      }
    }
  }

  return false;
}

export function assessWindow(
  result: WindowTranscript,
  speechSegmentsInWindow: readonly SpeechSegment[],
  constants: Partial<typeof RETRY_CONSTANTS> = {},
): WindowAssessment {
  const minSpeechForCheck = constants.minSpeechForCheckSeconds ?? RETRY_CONSTANTS.minSpeechForCheckSeconds;
  const minWordsPerSec = constants.minWordsPerSpeechSecond ?? RETRY_CONSTANTS.minWordsPerSpeechSecond;
  const edgeGap = constants.edgeGapSeconds ?? RETRY_CONSTANTS.edgeGapSeconds;
  const minRepeats = constants.minRepeats ?? RETRY_CONSTANTS.minRepeats;
  const maxPhraseLen = constants.maxPhraseLength ?? RETRY_CONSTANTS.maxPhraseLength;
  const maxJunkRatio = constants.maxJunkWordRatio ?? RETRY_CONSTANTS.maxJunkWordRatio;

  const words = result.words.filter((w) => w.kind !== "cue");

  const winStart = result.window.start;
  const winEnd = result.window.end;
  const winDuration = winEnd - winStart;

  // Segments are always window-relative [0, winDuration]
  const localSegments: SpeechSegment[] = [];
  let speechSeconds = 0;

  for (const seg of speechSegmentsInWindow) {
    const start = Math.max(0, seg.start);
    const end = Math.min(winDuration, seg.end);

    if (end > start) {
      localSegments.push({ start, end });
      speechSeconds += end - start;
    }
  }

  // 1. Check repetition loop first
  const tokens = words.map((w) => normalizeToken(w.text) || w.text.trim().toLowerCase()).filter(Boolean);

  if (hasRepetitionLoop(tokens, minRepeats, maxPhraseLen)) {
    return {
      flagged: true,
      reason: "repetition_loop",
      speechSeconds,
      flaggedRegion: { start: 0, end: winDuration },
    };
  }

  // 1b. Foreign script hallucination check (e.g. Urdu or Tamil script in Hindi/English/Hinglish mode)
  const lang = (result.language ?? "auto") as CaptionLanguage;
  const foreignScriptWords = countForeignScriptWords(words, lang);
  if (foreignScriptWords > 0) {
    return {
      flagged: true,
      reason: "foreign_script",
      speechSeconds,
      flaggedRegion: { start: 0, end: winDuration },
    };
  }

  // 1c. Junk output: words containing replacement characters, or too many words without letters or digits
  const hasCorruptedChar = words.some((w) => w.text.includes("\uFFFD"));
  const junkWords = countJunkWords(words);
  if (hasCorruptedChar || (junkWords > 0 && junkWords >= maxJunkRatio * words.length)) {
    return {
      flagged: true,
      reason: "junk_output",
      speechSeconds,
      flaggedRegion: { start: 0, end: winDuration },
    };
  }

  // If there's no speech in the window, nothing more to check
  if (localSegments.length === 0 || speechSeconds <= 0) {
    return { flagged: false, speechSeconds: 0 };
  }

  const firstSpeechStart = Math.min(...localSegments.map((s) => s.start));
  const lastSpeechEnd = Math.max(...localSegments.map((s) => s.end));

  // 2. Too few words check
  if (speechSeconds >= minSpeechForCheck) {
    const minRequiredWords = minWordsPerSec * speechSeconds;
    if (words.length < minRequiredWords) {
      return {
        flagged: true,
        reason: "too_few_words",
        speechSeconds,
        flaggedRegion: { start: firstSpeechStart, end: lastSpeechEnd },
      };
    }
  }

  // If words are present, check started late and stopped early
  if (words.length > 0) {
    const firstWordStart = words[0].start;
    const lastWordEnd = words[words.length - 1].end;

    // 3. Started late
    if (firstWordStart - firstSpeechStart > edgeGap) {
      return {
        flagged: true,
        reason: "started_late",
        speechSeconds,
        flaggedRegion: { start: firstSpeechStart, end: firstWordStart },
      };
    }

    // 4. Stopped early
    if (lastSpeechEnd - lastWordEnd > edgeGap) {
      return {
        flagged: true,
        reason: "stopped_early",
        speechSeconds,
        flaggedRegion: { start: lastWordEnd, end: lastSpeechEnd },
      };
    }

    // 5. Skipped speech in the middle of the window
    const uncovered = uncoveredSpeech(words, localSegments, constants);
    if (uncovered.seconds >= (constants.maxUncoveredSpeechSeconds ?? RETRY_CONSTANTS.maxUncoveredSpeechSeconds)) {
      return {
        flagged: true,
        reason: "skipped_speech",
        speechSeconds,
        flaggedRegion: { start: uncovered.start, end: uncovered.end },
      };
    }
  } else if (speechSeconds >= minSpeechForCheck) {
    return {
      flagged: true,
      reason: "too_few_words",
      speechSeconds,
      flaggedRegion: { start: firstSpeechStart, end: lastSpeechEnd },
    };
  }

  return { flagged: false, speechSeconds };
}
