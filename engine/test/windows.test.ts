import { describe, expect, it } from "vitest";
import { createWindows, planWindows, PLANNER_CONSTANTS } from "../src/whisper/windows";

describe("createWindows (fixed windows)", () => {
  it("handles empty and short media", () => {
    expect(createWindows(0)).toEqual([]);
    expect(createWindows(12)).toEqual([{ index: 0, start: 0, end: 12 }]);
    expect(createWindows(30)).toEqual([{ index: 0, start: 0, end: 30 }]);
  });

  it("overlaps a boundary and handles the final short window", () => {
    expect(createWindows(31)).toEqual([
      { index: 0, start: 0, end: 30 },
      { index: 1, start: 25, end: 31 },
    ]);
  });

  it("covers a one-hour file without a window beyond the duration", () => {
    const windows = createWindows(3_600);
    expect(windows.length).toBe(144);
    expect(windows[0]).toEqual({ index: 0, start: 0, end: 30 });
    expect(windows.at(-1)).toEqual({ index: 143, start: 3_575, end: 3_600 });
    expect(windows.every((window) => window.start < window.end && window.end <= 3_600)).toBe(true);
  });
});

describe("planWindows (VAD-directed window planner)", () => {
  it("returns a single window for files under 5s", () => {
    const windows = planWindows([], new Float32Array(50), 3.5);
    expect(windows).toEqual([{ index: 0, start: 0, end: 3.5 }]);
  });

  it("handles quiet/empty files with less than 1s speech", () => {
    const speech = [{ start: 1.0, end: 1.5 }]; // only 0.5s speech
    // Short file <= 28s: 1 window
    expect(planWindows(speech, new Float32Array(500), 20)).toEqual([{ index: 0, start: 0, end: 20 }]);
    // Longer file: fixed windows
    const longWindows = planWindows(speech, new Float32Array(1000), 60);
    expect(longWindows.length).toBeGreaterThan(1);
    expect(longWindows.every((w) => w.end - w.start <= 28)).toBe(true);
  });

  it("greedily groups nearby speech segments into windows <= 28s", () => {
    const segments = [
      { start: 1.0, end: 4.0 },
      { start: 6.0, end: 10.0 },
      { start: 12.0, end: 18.0 },
    ];
    const windows = planWindows(segments, new Float32Array(1000), 25);
    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBeCloseTo(1.0, 1);
    expect(windows[0].end).toBeLessThanOrEqual(25);
  });

  it("splits across long pauses without transcribing dead silence", () => {
    const segments = [
      { start: 2.0, end: 5.0 },
      { start: 40.0, end: 45.0 },
    ];
    const windows = planWindows(segments, new Float32Array(2000), 50);
    expect(windows).toHaveLength(2);
    expect(windows[0].end).toBeLessThan(10.0);
    expect(windows[1].start).toBeGreaterThan(35.0);
    // Gap between 10s and 35s is not in any window
    expect(windows[1].start - windows[0].end).toBeGreaterThan(25.0);
  });

  it("splits continuous speech longer than 28s at lowest-probability frame", () => {
    const duration = 60.0;
    const frameSec = PLANNER_CONSTANTS.frameSize / PLANNER_CONSTANTS.sampleRate; // 0.032s
    const totalFrames = Math.ceil(duration / frameSec);
    const probs = new Float32Array(totalFrames).fill(0.9);

    // Create a dip at 24s
    const dipFrame = Math.floor(24.0 / frameSec);
    probs[dipFrame] = 0.05;

    const segments = [{ start: 0.0, end: 60.0 }];
    const windows = planWindows(segments, probs, duration);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].end).toBeCloseTo(24.0, 1);
    expect(windows.every((w) => w.end - w.start <= 28)).toBe(true);
  });

  it("hard-splits with 2s forced overlap when no frame is below negThreshold", () => {
    const duration = 60.0;
    const frameSec = PLANNER_CONSTANTS.frameSize / PLANNER_CONSTANTS.sampleRate;
    const totalFrames = Math.ceil(duration / frameSec);
    // Continuous loud speech with no pause at all
    const probs = new Float32Array(totalFrames).fill(0.95);

    const segments = [{ start: 0.0, end: 60.0 }];
    const windows = planWindows(segments, probs, duration);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].end - windows[0].start).toBeCloseTo(28.0, 1);
    // Next window starts at 28 - 2 = 26
    expect(windows[1].start).toBeCloseTo(26.0, 1);
  });
});
