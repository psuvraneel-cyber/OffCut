import { describe, expect, it } from "vitest";
import {
  RETRY_CONSTANTS,
  assessWindow,
  hasRepetitionLoop,
  isJunkWord,
  removeJunkWords,
  removeRepetitionLoops,
  uncoveredSpeech,
} from "../src/whisper/retry";
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

// Shapes taken from a real base-fp16 failure: dash runs and an "I'm not a "I"" loop.
const at = (text: string, start = 1) => ({ text, start, end: start + 0.1 });

describe("Junk output and loop cleanup", () => {
  it("treats words without letters or digits as junk", () => {
    expect(isJunkWord("-")).toBe(true);
    expect(isJunkWord("- - - - - -")).toBe(true);
    expect(isJunkWord("...")).toBe(true);
    expect(isJunkWord("- I'm")).toBe(false);
    expect(isJunkWord("\"I\"")).toBe(false);
    expect(isJunkWord("2")).toBe(false);
    expect(isJunkWord("नमस्ते")).toBe(false);
  });

  it("flags a window whose output is mostly dashes", () => {
    const result = makeWindowResult([at("-"), at("- I'm"), at("- - - - - - - -")]);
    const assessment = assessWindow(result, [{ start: 0, end: 20 }]);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("junk_output");
  });

  it("does not flag normal speech with no junk", () => {
    const words = Array.from({ length: 12 }, (_, i) => at(`word${i}`, 1.2 + i * 0.7));
    expect(assessWindow(makeWindowResult(words), [{ start: 1, end: 10 }]).reason).not.toBe("junk_output");
  });

  it("removes junk words and keeps real ones", () => {
    const kept = removeJunkWords([at("-"), at("Yeah,"), at("- - -"), at("it's")]);
    expect(kept.map((w) => w.text)).toEqual(["Yeah,", "it's"]);
  });

  it("collapses a looped phrase to one copy", () => {
    const loop = ["\"I\"", "- I'm", "not", "a"];
    const words = [at("- The"), ...Array.from({ length: 40 }, (_, i) => at(loop[i % 4])), at("\"I")];
    const kept = removeRepetitionLoops(words).map((w) => w.text);
    expect(kept).toEqual(["- The", "\"I\"", "- I'm", "not", "a", "\"I"]);
  });

  it("collapses a single repeated word and leaves short repeats alone", () => {
    const thanks = Array.from({ length: 6 }, () => at("thanks"));
    expect(removeRepetitionLoops(thanks).map((w) => w.text)).toEqual(["thanks"]);
    const shortRepeat = ["no", "no", "no", "stop"].map((t) => at(t));
    expect(removeRepetitionLoops(shortRepeat).map((w) => w.text)).toEqual(["no", "no", "no", "stop"]);
  });

  it("keeps ordinary text unchanged", () => {
    const words = ["Yeah,", "it's", "a", "Tesla", "Roadster.", "The", "one", "that", "can", "fly."].map((t) => at(t));
    expect(removeRepetitionLoops(words)).toEqual(words);
  });
});

describe("Runaway long words", () => {
  it("treats a word over 40 characters as junk", () => {
    expect(isJunkWord("क".repeat(296))).toBe(true);
    expect(isJunkWord("a".repeat(41))).toBe(true);
  });

  it("keeps long real words, including Devanagari with combining marks", () => {
    expect(isJunkWord("Donaudampfschifffahrtsgesellschaft")).toBe(false);
    expect(isJunkWord("उत्तरप्रदेश")).toBe(false);
    expect(isJunkWord("a".repeat(40))).toBe(false);
  });

  it("drops runaway words before merging", () => {
    const kept = removeJunkWords([at("नमस्ते"), at("क".repeat(296)), at("दोस्तों")]);
    expect(kept.map((w) => w.text)).toEqual(["नमस्ते", "दोस्तों"]);
  });
});

// Real word timings from base on WASM (q8), Tesla video window 2 (absolute seconds shifted to the window).
const stretched = [
  ["to", 28.05, 28.17], ["end", 28.17, 28.33], ["things", 28.33, 28.53], ["right", 28.53, 28.83], ["now.", 28.83, 29.07],
  ["What", 29.13, 29.21], ["about", 29.21, 29.41], ["now?", 29.41, 30.15], ["Why", 30.31, 33.69], ["is", 33.69, 37.19],
  ["it", 37.19, 38.81], ["so", 38.81, 38.95], ["fucking", 38.95, 39.37], ["loud?", 39.37, 39.85], ["Two", 39.91, 40.35],
  ["inches", 40.35, 40.57], ["in", 40.57, 40.73], ["the", 40.73, 40.87], ["air", 40.87, 41.17],
].map(([text, start, end]) => ({ text: text as string, start: (start as number) - 26, end: (end as number) - 26 }));
// The VAD's speech segments for the same stretch (26.0–30.7, 30.7–34.7, 34.7–35.8, 36.9–49.4 s).
const stretchedSpeech = [
  { start: 0, end: 4.7 }, { start: 4.7, end: 8.7 }, { start: 8.7, end: 9.8 }, { start: 10.9, end: 23.4 },
];

describe("Skipped speech hidden by stretched words", () => {
  it("measures speech not covered by normal-length words", () => {
    const uncovered = uncoveredSpeech(stretched, stretchedSpeech);
    expect(uncovered.seconds).toBeGreaterThanOrEqual(RETRY_CONSTANTS.maxUncoveredSpeechSeconds);
    expect(uncovered.start).toBeGreaterThan(5);
    expect(uncovered.end).toBeLessThan(13);
  });

  it("flags the window as skipped_speech and points at the stretched stretch", () => {
    const result = makeWindowResult(stretched, 26, 41.5);
    const assessment = assessWindow(result, stretchedSpeech);
    expect(assessment.reason).toBe("skipped_speech");
    expect(assessment.flaggedRegion!.start).toBeGreaterThan(5);
  });

  it("doesn't flag ordinary speech with pauses between phrases", () => {
    const words = Array.from({ length: 30 }, (_, i) => at(`w${i}`, (i < 15 ? 1 : 10) + (i % 15) * 0.4));
    const speech = [{ start: 0.8, end: 7.2 }, { start: 9.8, end: 16.2 }];
    expect(assessWindow(makeWindowResult(words), speech).flagged).toBe(false);
  });

  it("doesn't count silence the VAD didn't mark as speech", () => {
    const words = [at("hello", 1), at("again", 12)];
    expect(uncoveredSpeech(words, [{ start: 0.9, end: 1.4 }, { start: 11.9, end: 12.4 }]).seconds).toBe(0);
  });
});

describe("Long-phrase loops (tiny on WASM)", () => {
  const phrase = "the only thing that's going to be".split(" ");
  const looped = [at("It's"), at("not"), ...Array.from({ length: 70 }, (_, i) => at(phrase[i % 7]))];

  it("detects a 7-word phrase repeated 10 times", () => {
    expect(hasRepetitionLoop(looped.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")))).toBe(true);
  });

  it("keeps one copy of the looped phrase", () => {
    expect(removeRepetitionLoops(looped).map((w) => w.text)).toEqual(["It's", "not", ...phrase]);
  });
});

describe("Cue handling in retry and assessment", () => {
  it("does not flag a window with 12 normal words plus 20 cue words as junk or loop", () => {
    const speech = [{ start: 1, end: 11 }];
    const normalWords = Array.from({ length: 12 }, (_, i) => ({
      text: `word${i}`,
      start: 1.2 + i * 0.7,
      end: 1.8 + i * 0.7,
    }));
    const cueWords = Array.from({ length: 20 }, (_, i) => ({
      text: "(laughing)",
      start: 1.3 + i * 0.4,
      end: 1.6 + i * 0.4,
      kind: "cue" as const,
    }));
    const result = makeWindowResult([...normalWords, ...cueWords]);
    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(false);
  });

  it("removeRepetitionLoops keeps 5 identical (laughing) cues", () => {
    const cues = Array.from({ length: 5 }, (_, i) => ({
      text: "(laughing)",
      start: 1 + i * 0.5,
      end: 1.4 + i * 0.5,
      kind: "cue" as const,
    }));
    const kept = removeRepetitionLoops(cues);
    expect(kept).toHaveLength(5);
    expect(kept).toEqual(cues);
  });

  it("flags foreign script hallucinations (such as Urdu or Tamil in Hindi/English/Hinglish)", () => {
    const speech = [{ start: 1, end: 11 }];
    const words = [
      { text: "யுஎல்சி", start: 1.0, end: 1.5 },
      { text: "میں", start: 1.6, end: 2.0 },
      { text: "ہم", start: 2.1, end: 2.5 },
      { text: "aur", start: 2.6, end: 3.0 },
      { text: "broker", start: 3.1, end: 3.5 },
    ];
    const result = makeWindowResult(words);
    result.language = "hinglish";
    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("foreign_script");
  });

  it("identifies \\uFFFD replacement characters as junk words and purges them", () => {
    expect(isJunkWord("\uFFFD")).toBe(true);
    expect(isJunkWord("Hello\uFFFD")).toBe(true);
    expect(isJunkWord("\uFFFD\uFFFD\uFFFD\uFFFD")).toBe(true);

    const cleaned = removeJunkWords([
      { text: "Hello", start: 0, end: 1 },
      { text: "\uFFFD\uFFFD\uFFFD", start: 1, end: 2 },
      { text: "world", start: 2, end: 3 },
    ]);
    expect(cleaned.map((w) => w.text)).toEqual(["Hello", "world"]);
  });

  it("flags output with \\uFFFD corrupted characters as junk_output", () => {
    const speech = [{ start: 0, end: 10 }];
    const words = [
      { text: "\uFFFD\uFFFD\uFFFD", start: 1.0, end: 5.0 },
      { text: "\uFFFD\uFFFD\uFFFD", start: 5.0, end: 9.0 },
    ];
    const result = makeWindowResult(words);
    const assessment = assessWindow(result, speech);
    expect(assessment.flagged).toBe(true);
    expect(assessment.reason).toBe("junk_output");
  });
});
