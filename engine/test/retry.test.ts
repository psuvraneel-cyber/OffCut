import { describe, expect, it } from "vitest";
import { assessWindow, hasRepetitionLoop } from "../src/whisper/retry";
import type { WindowTranscript } from "../src/types";

function makeWindowResult(
  words: { text: string; start: number; end: number }[],
  winStart = 0,
  winEnd = 25,
): WindowTranscript {
  return {
    window: { index: 0, start: winStart, end: winEnd },
    granularity: "word",
    language: "en",
    segments: [],
    words,
  };
}

describe("Window assessment and retry detector", () => {
  it("detects repetition loops for 1-4 word phrases repeated >= 4 times", () => {
    expect(hasRepetitionLoop(["thank", "you", "thank", "you", "thank", "you", "thank", "you"])).toBe(true);
    expect(hasRepetitionLoop(["hello", "hello", "hello", "hello"])).toBe(true);
    expect(hasRepetitionLoop(["one", "two", "three", "four", "one", "two", "three", "four", "one", "two", "three", "four", "one", "two", "three", "four"])).toBe(true);
    expect(hasRepetitionLoop(["hello", "world", "this", "is", "fine"])).toBe(false);
  });

  it("passes when speech and words are well aligned", () => {
    // 10s speech from 1s to 11s, with 12 words
    const speech = [{ start: 1, end: 11 }];
    const words = Array.from({ length: 12 }, (_, i) => ({
      text: `word${i}`,
      start: 1.2 + i * 0.7,
      end: 1.8 + i * 0.7,
    }));
    const result = makeWindowResult(words);

    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(false);
  });

  it("flags when words are fewer than 0.8 words/sec for >= 5s speech", () => {
    // 10s speech (requires >= 8 words), but only 2 words returned
    const speech = [{ start: 1, end: 11 }];
    const words = [
      { text: "first", start: 1.5, end: 2.0 },
      { text: "second", start: 9.0, end: 9.5 },
    ];
    const result = makeWindowResult(words);

    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("too_few_words");
  });

  it("flags when transcription stopped early (>4s before speech end)", () => {
    // 15s speech from 0s to 15s. 12 words, but last word ends at 9s (gap = 6s > 4s)
    const speech = [{ start: 0, end: 15 }];
    const words = Array.from({ length: 12 }, (_, i) => ({
      text: `word${i}`,
      start: 0.5 + i * 0.7,
      end: 1.0 + i * 0.7, // ends around 8.7s
    }));
    const result = makeWindowResult(words);

    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("stopped_early");
  });

  it("flags when transcription started late (>4s after speech start)", () => {
    // Speech starts at 1s, but first word starts at 6s (gap = 5s > 4s)
    const speech = [{ start: 1, end: 15 }];
    const words = Array.from({ length: 12 }, (_, i) => ({
      text: `word${i}`,
      start: 6.0 + i * 0.7,
      end: 6.5 + i * 0.7,
    }));
    const result = makeWindowResult(words);

    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("started_late");
  });

  it("flags repetition loops even if word count is high", () => {
    const speech = [{ start: 0, end: 10 }];
    const words = [
      { text: "you", start: 1, end: 2 },
      { text: "know", start: 2, end: 3 },
      { text: "you", start: 3, end: 4 },
      { text: "know", start: 4, end: 5 },
      { text: "you", start: 5, end: 6 },
      { text: "know", start: 6, end: 7 },
      { text: "you", start: 7, end: 8 },
      { text: "know", start: 8, end: 9 },
    ];
    const result = makeWindowResult(words);

    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("repetition_loop");
  });

  it("does not flag a window starting at 10s with speech at 12-26s covered by words", () => {
    // Window: start 10s, end 38s (28s duration).
    // Speech inside window: from 12s to 26s (14s of speech, requires >= 11.2 words).
    const speech = [{ start: 12, end: 26 }];
    // Words covering that speech: from 12.5s to 25.5s with 15 words
    const words = Array.from({ length: 15 }, (_, i) => ({
      text: `word${i}`,
      start: 12.5 + i * 0.85,
      end: 13.0 + i * 0.85,
    }));
    const result = makeWindowResult(words, 10, 38);

    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(false);
  });
});
