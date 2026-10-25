import { describe, expect, it } from "vitest";
import { mergeWindowTranscripts } from "../src/whisper/merge";
import type { WindowTranscript } from "../src/types";

describe("mergeWindowTranscripts", () => {
  it("keeps exactly one word when overlap has 'test.' in A and 'test' in B", () => {
    // Cut point between [0, 30] and [25, 55] is (25 + 30) / 2 = 27.5
    const results: WindowTranscript[] = [
      {
        window: { index: 0, start: 0, end: 30 },
        granularity: "word",
        language: "en",
        words: [{ text: "test.", start: 26.0, end: 26.4 }], // midpoint = 26.2 < 27.5 -> kept in A
        segments: [],
      },
      {
        window: { index: 1, start: 25, end: 55 },
        granularity: "word",
        language: "en",
        words: [{ text: "test", start: 1.0, end: 1.4 }], // absolute: 26.0–26.4, midpoint = 26.2 < 27.5 -> dropped in B
        segments: [],
      },
    ];

    const merged = mergeWindowTranscripts(results, 55);
    expect(merged.words).toHaveLength(1);
    expect(merged.words[0].text).toBe("test.");
  });

  it("keeps a word straddling the cut point exactly once", () => {
    // Cut point is 27.5. Straddling word is 27.3–27.7 (midpoint = 27.5).
    const results: WindowTranscript[] = [
      {
        window: { index: 0, start: 0, end: 30 },
        granularity: "word",
        language: "en",
        words: [{ text: "straddle", start: 27.3, end: 27.7 }], // midpoint 27.5 is not < 27.5 -> dropped from A
        segments: [],
      },
      {
        window: { index: 1, start: 25, end: 55 },
        granularity: "word",
        language: "en",
        words: [{ text: "straddle", start: 2.3, end: 2.7 }], // absolute 27.3–27.7, midpoint 27.5 >= 27.5 -> kept in B
        segments: [],
      },
    ];

    const merged = mergeWindowTranscripts(results, 55);
    expect(merged.words).toHaveLength(1);
    expect(merged.words[0].text).toBe("straddle");
    expect(merged.words[0].start).toBeCloseTo(27.3, 1);
  });

  it("does not lose words right before or after the cut", () => {
    // Cut point is 27.5
    const results: WindowTranscript[] = [
      {
        window: { index: 0, start: 0, end: 30 },
        granularity: "word",
        language: "en",
        words: [
          { text: "before_cut", start: 27.0, end: 27.4 }, // midpoint 27.2 < 27.5 -> kept in A
          { text: "after_cut", start: 27.6, end: 28.0 }, // midpoint 27.8 >= 27.5 -> dropped in A
        ],
        segments: [],
      },
      {
        window: { index: 1, start: 25, end: 55 },
        granularity: "word",
        language: "en",
        words: [
          { text: "before_cut", start: 2.0, end: 2.4 }, // absolute 27.0–27.4 -> dropped in B
          { text: "after_cut", start: 2.6, end: 3.0 }, // absolute 27.6–28.0 -> kept in B
        ],
        segments: [],
      },
    ];

    const merged = mergeWindowTranscripts(results, 55);
    expect(merged.words.map((w) => w.text)).toEqual(["before_cut", "after_cut"]);
    expect(merged.words[0].end).toBeLessThanOrEqual(merged.words[1].start);
  });

  it("handles three windows, including a short last window", () => {
    // Windows: [0, 30], [25, 55], [50, 65]
    // Cut 0-1: 27.5. Cut 1-2: 52.5.
    const results: WindowTranscript[] = [
      {
        window: { index: 0, start: 0, end: 30 },
        granularity: "word",
        language: "en",
        words: [
          { text: "intro", start: 5, end: 6 },
          { text: "middle1", start: 26, end: 27 }, // midpoint 26.5 < 27.5 -> kept in w0
        ],
        segments: [],
      },
      {
        window: { index: 1, start: 25, end: 55 },
        granularity: "word",
        language: "en",
        words: [
          { text: "middle1", start: 1, end: 2 }, // abs 26–27 -> dropped in w1
          { text: "middle2", start: 15, end: 16 }, // abs 40–41 -> kept in w1
          { text: "bridge", start: 26, end: 27 }, // abs 51–52, midpoint 51.5 < 52.5 -> kept in w1
        ],
        segments: [],
      },
      {
        window: { index: 2, start: 50, end: 65 },
        granularity: "word",
        language: "en",
        words: [
          { text: "bridge", start: 1, end: 2 }, // abs 51–52 -> dropped in w2
          { text: "outro", start: 10, end: 11 }, // abs 60–61 -> kept in w2
        ],
        segments: [],
      },
    ];

    const merged = mergeWindowTranscripts(results, 65);
    expect(merged.words.map((w) => w.text)).toEqual(["intro", "middle1", "middle2", "bridge", "outro"]);
    expect(merged.words.every((w, i, arr) => i === 0 || w.start >= arr[i - 1].end)).toBe(true);
    expect(merged.segments.length).toBeGreaterThan(0);
  });

  it("ensures output is sorted with no overlaps, and zero-length input words get positive length", () => {
    const results: WindowTranscript[] = [
      {
        window: { index: 0, start: 0, end: 30 },
        granularity: "word",
        language: "en",
        words: [
          { text: "The", start: 3.52, end: 3.52 }, // zero-length word
          { text: "quick", start: 3.8, end: 4.2 },
        ],
        segments: [],
      },
    ];

    const merged = mergeWindowTranscripts(results, 30);
    expect(merged.words).toHaveLength(2);
    expect(merged.words[0].text).toBe("The");
    expect(merged.words[0].end - merged.words[0].start).toBeGreaterThanOrEqual(0.08);
    expect(merged.words[0].end).toBeLessThanOrEqual(merged.words[1].start);
    expect(merged.words.every((w) => w.start <= w.end)).toBe(true);
  });

  it("merges segment-granularity overlap results using the cut rule on midpoints", () => {
    // Cut point is 27.5
    const results: WindowTranscript[] = [
      {
        window: { index: 0, start: 0, end: 30 },
        granularity: "segment",
        language: "hi",
        segments: [
          {
            text: "namaste dosto",
            start: 24,
            end: 26, // midpoint 25 < 27.5 -> kept
            words: [
              { text: "namaste", start: 24, end: 25 },
              { text: "dosto", start: 25, end: 26 },
            ],
          },
        ],
        words: [],
      },
      {
        window: { index: 1, start: 25, end: 55 },
        granularity: "segment",
        language: "hi",
        segments: [
          {
            text: "namaste dosto",
            start: 0,
            end: 2, // absolute 25–27, midpoint 26 < 27.5 -> dropped
            words: [
              { text: "namaste", start: 0, end: 1 },
              { text: "dosto", start: 1, end: 2 },
            ],
          },
          {
            text: "kaise ho",
            start: 4,
            end: 6, // absolute 29–31, midpoint 30 >= 27.5 -> kept
            words: [
              { text: "kaise", start: 4, end: 5 },
              { text: "ho", start: 5, end: 6 },
            ],
          },
        ],
        words: [],
      },
    ];

    const merged = mergeWindowTranscripts(results, 55);
    expect(merged.granularity).toBe("segment");
    expect(merged.segments).toHaveLength(2);
    expect(merged.segments[0].text).toBe("namaste dosto");
    expect(merged.segments[0].start).toBe(24);
    expect(merged.segments[0].end).toBe(26);
    expect(merged.segments[1].text).toBe("kaise ho");
    expect(merged.segments[1].start).toBe(29);
    expect(merged.segments[1].end).toBe(31);
  });
});
