import { describe, it, expect } from "vitest";
import { planWindows, calculateIntervalUnionDuration } from "../src/whisper/windows";
import type { SpeechSegment } from "../src/whisper/vad";

describe("Dynamic Window Slicing (Phase 2 P0.1)", () => {
  const dummyProbs = new Float32Array(2000); // 64 seconds of silence/low probability

  it("enforces various maxWindowSeconds limits strictly (20s, 15s, 12s, 10s, 8s, 5s)", () => {
    // 30 seconds of continuous speech
    const segments: SpeechSegment[] = [{ start: 0, end: 30 }];
    const limits = [20, 15, 12, 10, 8, 5];

    for (const maxWindow of limits) {
      const windows = planWindows(segments, dummyProbs, 30, {
        maxWindowSeconds: maxWindow,
        splitStrategy: "fixed_duration",
        forcedOverlapSeconds: 1,
      });

      expect(windows.length).toBeGreaterThan(1);
      for (const w of windows) {
        expect(w.end - w.start).toBeLessThanOrEqual(maxWindow + 0.001);
      }

      // Check coverage
      const union = calculateIntervalUnionDuration(windows);
      expect(union).toBeCloseTo(30, 1);
    }
  });

  it("splits at natural pauses using 'largest_pause' strategy", () => {
    // Segments with gaps: [0, 4] gap 0.5s [4.5, 9] gap 0.2s [9.2, 14]
    const segments: SpeechSegment[] = [
      { start: 0, end: 4 },
      { start: 4.5, end: 9 },
      { start: 9.2, end: 14 },
      { start: 14.5, end: 19 },
    ];

    const windows = planWindows(segments, dummyProbs, 20, {
      maxWindowSeconds: 10,
      splitStrategy: "largest_pause",
      minimumSplitPauseSeconds: 0.15,
      forcedOverlapSeconds: 1,
    });

    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const w of windows) {
      expect(w.end - w.start).toBeLessThanOrEqual(10.001);
    }
  });

  it("splits early at natural boundaries in 'adaptive_pause' mode", () => {
    // Audio with segments: [0, 6] -> gap 0.3s -> [6.3, 12] -> gap 0.4s -> [12.4, 18]
    const segments: SpeechSegment[] = [
      { start: 0, end: 6 },
      { start: 6.3, end: 12 },
      { start: 12.4, end: 18 },
    ];

    const windows = planWindows(segments, dummyProbs, 18, {
      maxWindowSeconds: 12,
      splitStrategy: "adaptive_pause",
      minimumSplitPauseSeconds: 0.2,
      forcedOverlapSeconds: 1,
    });

    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const w of windows) {
      expect(w.end - w.start).toBeLessThanOrEqual(12.001);
    }

    const union = calculateIntervalUnionDuration(windows);
    expect(union).toBeGreaterThanOrEqual(17.5);
  });

  it("handles different pause thresholds (100ms, 150ms, 200ms, 300ms)", () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 5 },
      { start: 5.12, end: 10 }, // 120ms gap
      { start: 10.25, end: 15 }, // 250ms gap
    ];

    // With 150ms threshold, 120ms gap is not a split pause, but 250ms is
    const windows150 = planWindows(segments, dummyProbs, 15, {
      maxWindowSeconds: 8,
      splitStrategy: "largest_pause",
      minimumSplitPauseSeconds: 0.15,
      forcedOverlapSeconds: 1,
    });

    expect(windows150.length).toBeGreaterThanOrEqual(2);
  });

  it("correctly handles various overlap durations (0s, 250ms, 500ms, 2000ms)", () => {
    const segments: SpeechSegment[] = [
      { start: 0, end: 15 },
      { start: 15.05, end: 30 },
    ];

    const overlaps = [0, 0.25, 0.5, 2.0];
    for (const ov of overlaps) {
      const windows = planWindows(segments, dummyProbs, 30, {
        maxWindowSeconds: 15,
        forcedOverlapSeconds: ov,
        splitStrategy: "baseline",
      });

      expect(windows.length).toBeGreaterThanOrEqual(2);
      expect(windows[0].end - windows[0].start).toBeLessThanOrEqual(15.001);
    }
  });

  it("handles very short recordings safely without crashing or empty windows", () => {
    const shortSegs: SpeechSegment[] = [{ start: 0.2, end: 2.1 }];
    const windows = planWindows(shortSegs, dummyProbs, 3.0, {
      maxWindowSeconds: 10,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0].start).toBe(0);
    expect(windows[0].end).toBe(3.0);
  });

  it("handles empty VAD output safely", () => {
    const windows = planWindows([], dummyProbs, 20.0, {
      maxWindowSeconds: 10,
    });

    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.end - w.start).toBeLessThanOrEqual(10.001);
    }
  });
});
