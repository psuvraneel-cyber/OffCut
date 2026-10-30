import type { AudioWindow, WindowSplitStrategy } from "../types";
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
  minSilenceGapToOmitSeconds: 5.0,
  minimumSplitPauseSeconds: 0.15,
} as const;

export interface WindowPlanningOptions {
  maxWindowSeconds?: number;
  forcedOverlapSeconds?: number;
  minSilenceGapToOmitSeconds?: number;
  negThreshold?: number;
  speechPadMs?: number;
  frameSize?: number;
  sampleRate?: number;
  splitStrategy?: WindowSplitStrategy;
  minimumSplitPauseSeconds?: number;
}

/**
 * Calculates the exact union duration of an array of intervals without double-counting overlaps.
 */
export function calculateIntervalUnionDuration(
  intervals: readonly { start: number; end: number }[],
): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals]
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sorted.length === 0) return 0;

  const merged: { start: number; end: number }[] = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = merged[merged.length - 1];
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }

  return merged.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
}

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
  constants: WindowPlanningOptions = {},
): AudioWindow[] {
  const maxWindow = constants.maxWindowSeconds ?? PLANNER_CONSTANTS.maxWindowSeconds;
  let forcedOverlap = constants.forcedOverlapSeconds ?? PLANNER_CONSTANTS.forcedOverlapSeconds;
  if (forcedOverlap >= maxWindow) {
    forcedOverlap = Math.max(0, maxWindow / 4);
  }

  const negThreshold = constants.negThreshold ?? PLANNER_CONSTANTS.negThreshold;
  const padSec = (constants.speechPadMs ?? PLANNER_CONSTANTS.speechPadMs) / 1000;
  const frameSec =
    (constants.frameSize ?? PLANNER_CONSTANTS.frameSize) /
    (constants.sampleRate ?? PLANNER_CONSTANTS.sampleRate);
  const splitStrategy: WindowSplitStrategy = constants.splitStrategy ?? "baseline";
  const minSplitPause = constants.minimumSplitPauseSeconds ?? PLANNER_CONSTANTS.minimumSplitPauseSeconds;
  const minGapToOmit = constants.minSilenceGapToOmitSeconds ?? PLANNER_CONSTANTS.minSilenceGapToOmitSeconds;

  // 1. Short files (<5s)
  if (duration < 5) {
    return [{ index: 0, start: 0, end: duration }];
  }

  // 2. Fixed-duration slicing strategy (bypasses pause alignment if requested for ablation)
  if (splitStrategy === "fixed_duration") {
    return createWindows(duration, maxWindow, forcedOverlap);
  }

  // 3. Check total speech duration
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

  // 4. Break any individual speech segment > maxWindow into pieces <= maxWindow
  const splitSegments: SpeechSegment[] = [];
  for (const seg of segments) {
    let curStart = seg.start;
    while (seg.end - curStart > maxWindow) {
      const searchStartSec = curStart + Math.min(20, Math.max(0, maxWindow * 0.6));
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
        curStart = Math.max(0, splitSec - forcedOverlap);
      }
    }
    if (seg.end > curStart) {
      splitSegments.push({ start: curStart, end: seg.end });
    }
  }

  if (splitSegments.length === 0) {
    return createWindows(duration, maxWindow, 5);
  }

  // 5. Window aggregation according to splitStrategy
  const windows: AudioWindow[] = [];
  let curWinStart = Math.max(0, splitSegments[0].start);
  let prevSegEnd = splitSegments[0].end;

  for (let i = 1; i < splitSegments.length; i++) {
    const nextSeg = splitSegments[i];
    const candidateEnd = nextSeg.end;
    const currentSpan = candidateEnd - curWinStart;

    let shouldSplit = currentSpan > maxWindow;

    // In adaptive_pause mode, if we are in the target zone (>= 65% of maxWindow)
    // and there is a natural pause >= minSplitPause, prefer splitting early at natural boundary
    if (!shouldSplit && splitStrategy === "adaptive_pause") {
      const accumulated = prevSegEnd - curWinStart;
      const gapToNext = nextSeg.start - prevSegEnd;
      if (accumulated >= maxWindow * 0.65 && gapToNext >= minSplitPause) {
        shouldSplit = true;
      }
    }

    if (!shouldSplit) {
      prevSegEnd = nextSeg.end;
    } else {
      const gap = Math.max(0, nextSeg.start - prevSegEnd);

      if (gap >= minGapToOmit) {
        // Long silence: omit dead air between segments
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
      } else {
        // Small gap or continuous speech
        const closeCut = prevSegEnd + Math.min(padSec, gap / 2);
        const winEnd = Math.min(
          duration,
          Math.min(curWinStart + maxWindow, Math.max(curWinStart + 0.1, closeCut)),
        );

        windows.push({
          index: windows.length,
          start: curWinStart,
          end: winEnd,
        });

        if ((splitStrategy === "largest_pause" || splitStrategy === "adaptive_pause") && gap >= minSplitPause) {
          // Clean pause split: start next window at the next segment onset (with small pad)
          const openCut = Math.max(0, nextSeg.start - Math.min(padSec, gap / 2));
          curWinStart = openCut;
        } else {
          // Baseline behavior or tiny pause: enforce forced overlap
          curWinStart = Math.max(0, Math.min(nextSeg.start, winEnd - forcedOverlap));
        }
        prevSegEnd = nextSeg.end;
      }
    }
  }

  const finalGap = Math.max(0, duration - prevSegEnd);
  const finalEnd = Math.min(
    duration,
    Math.min(curWinStart + maxWindow, prevSegEnd + Math.min(padSec, finalGap / 2)),
  );
  windows.push({
    index: windows.length,
    start: curWinStart,
    end: Math.max(curWinStart + 0.1, finalEnd),
  });

  return windows;
}
