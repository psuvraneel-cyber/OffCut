import type { WindowTranscript } from "../types";
import type { SpeechSegment } from "./vad";

export const RETRY_CONSTANTS = {
  minSpeechForCheckSeconds: 5,
  minWordsPerSpeechSecond: 0.8,
  edgeGapSeconds: 4,
  minRepeats: 4,
  maxPhraseLength: 4,
} as const;

export type AssessmentReason =
  | "too_few_words"
  | "stopped_early"
  | "started_late"
  | "repetition_loop";

export interface WindowAssessment {
  flagged: boolean;
  reason?: AssessmentReason;
  speechSeconds: number;
  flaggedRegion?: { start: number; end: number };
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
  const tokens = result.words
    .map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "").trim())
    .filter(Boolean);

  if (hasRepetitionLoop(tokens, minRepeats, maxPhraseLen)) {
    return {
      flagged: true,
      reason: "repetition_loop",
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
    if (result.words.length < minRequiredWords) {
      return {
        flagged: true,
        reason: "too_few_words",
        speechSeconds,
        flaggedRegion: { start: firstSpeechStart, end: lastSpeechEnd },
      };
    }
  }

  // If words are present, check started late and stopped early
  if (result.words.length > 0) {
    const firstWordStart = result.words[0].start;
    const lastWordEnd = result.words[result.words.length - 1].end;

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
