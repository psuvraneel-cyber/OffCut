import type { AudioWindow } from "../types";

export const WINDOW_SECONDS = 30;
export const OVERLAP_SECONDS = 5;
export const WINDOW_STEP_SECONDS = WINDOW_SECONDS - OVERLAP_SECONDS;

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
