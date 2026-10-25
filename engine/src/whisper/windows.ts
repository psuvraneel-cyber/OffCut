import type { AudioWindow } from "../types";
import type { SpeechSegment } from "./vad";

export const WINDOW_SECONDS = 30;
export const OVERLAP_SECONDS = 5;
export const WINDOW_STEP_SECONDS = WINDOW_SECONDS - OVERLAP_SECONDS;

export const PLANNER_CONSTANTS = {
  maxWindowSeconds: 28,
  forcedOverlapSeconds: 2,
  negThreshold: 0.35,
  speechPadMs: 200,
  frameSize: 512,
  sampleRate: 16000,
  maxSamples: 480000,
} as const;

export function createWindows(
  duration: number,
  windowSeconds = WINDOW_SECONDS,
  overlapSeconds = OVERLAP_SECONDS,
): AudioWindow[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [];
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new RangeError("windowSeconds must be positive.");
  }
  if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0 || overlapSeconds >= windowSeconds) {
    throw new RangeError("overlapSeconds must be non-negative and smaller than windowSeconds.");
  }

  const step = windowSeconds - overlapSeconds;
  const windows: AudioWindow[] = [];
  let start = 0;
  let index = 0;

  while (start < duration) {
    const end = Math.min(duration, start + windowSeconds);
    windows.push({ index, start, end });
    if (end >= duration) {
      break;
    }
    start += step;
    index += 1;
  }

  return windows;
}

export function planWindows(
  segments: readonly SpeechSegment[],
  probs: Float32Array | readonly number[],
  duration: number,
  constants: Partial<typeof PLANNER_CONSTANTS> = {},
): AudioWindow[] {
  const maxWindow = constants.maxWindowSeconds ?? PLANNER_CONSTANTS.maxWindowSeconds;
  const forcedOverlap = constants.forcedOverlapSeconds ?? PLANNER_CONSTANTS.forcedOverlapSeconds;
  const negThreshold = constants.negThreshold ?? PLANNER_CONSTANTS.negThreshold;
  const padSec = (constants.speechPadMs ?? PLANNER_CONSTANTS.speechPadMs) / 1000;
  const frameSec = (constants.frameSize ?? PLANNER_CONSTANTS.frameSize) / (constants.sampleRate ?? PLANNER_CONSTANTS.sampleRate);

  // 1. Short files (<5s)
  if (duration < 5) {
    return [{ index: 0, start: 0, end: duration }];
  }

  // 2. Check total speech duration
  let totalSpeechSec = 0;
  for (const s of segments) {
    totalSpeechSec += Math.max(0, s.end - s.start);
  }

  if (totalSpeechSec < 1.0) {
    if (duration <= maxWindow) {
      return [{ index: 0, start: 0, end: duration }];
    }
    return createWindows(duration, maxWindow, 5);
  }

  // 3. Break any long speech segment (>28s) into pieces <= 28s
  const splitSegments: SpeechSegment[] = [];
  for (const seg of segments) {
    let curStart = seg.start;
    while (seg.end - curStart > maxWindow) {
      const searchStartSec = curStart + 20;
      const searchEndSec = curStart + maxWindow;
      const startFrame = Math.max(0, Math.floor(searchStartSec / frameSec));
      const endFrame = Math.min(probs.length - 1, Math.floor(searchEndSec / frameSec));

      let minProb = Infinity;
      let minFrame = -1;
      for (let f = startFrame; f <= endFrame; f++) {
        if (probs[f] < minProb) {
          minProb = probs[f];
          minFrame = f;
        }
      }

      if (minFrame !== -1 && minProb < negThreshold) {
        const splitSec = minFrame * frameSec;
        splitSegments.push({ start: curStart, end: splitSec });
        curStart = splitSec;
      } else {
        const splitSec = curStart + maxWindow;
        splitSegments.push({ start: curStart, end: splitSec });
        curStart = splitSec - forcedOverlap;
      }
    }
    if (seg.end > curStart) {
      splitSegments.push({ start: curStart, end: seg.end });
    }
  }

  if (splitSegments.length === 0) {
    return createWindows(duration, maxWindow, 5);
  }

  // 4. Greedy window merging
  const windows: AudioWindow[] = [];
  let curWinStart = Math.max(0, splitSegments[0].start);
  let prevSegEnd = splitSegments[0].end;

  for (let i = 1; i < splitSegments.length; i++) {
    const nextSeg = splitSegments[i];
    const candidateEnd = nextSeg.end;

    if (candidateEnd - curWinStart <= maxWindow) {
      prevSegEnd = nextSeg.end;
    } else {
      const gap = Math.max(0, nextSeg.start - prevSegEnd);
      const closeCut = prevSegEnd + Math.min(padSec, gap / 2);
      const winEnd = Math.min(duration, Math.min(curWinStart + maxWindow, closeCut));

      windows.push({
        index: windows.length,
        start: curWinStart,
        end: Math.max(curWinStart + 0.1, winEnd),
      });

      const openCut = nextSeg.start - Math.min(padSec, gap / 2);
      curWinStart = Math.max(0, openCut);
      prevSegEnd = nextSeg.end;
    }
  }

  const finalGap = Math.max(0, duration - prevSegEnd);
  const finalEnd = Math.min(duration, Math.min(curWinStart + maxWindow, prevSegEnd + Math.min(padSec, finalGap / 2)));
  windows.push({
    index: windows.length,
    start: curWinStart,
    end: Math.max(curWinStart + 0.1, finalEnd),
  });

  return windows;
}
