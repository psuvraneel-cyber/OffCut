import { describe, expect, it } from "vitest";
import {
  buildCaptionCues,
  toSrt,
  toVtt,
  type CaptionCue,
} from "../src/captions";
import type { Word } from "../src/types";

describe("Caption building and export", () => {
  it("A sentence of 8 short words becomes 1 caption with 2 wrapped lines, with exact text and times", () => {
    const words: Word[] = [
      { text: "The", start: 0.0, end: 0.4 },
      { text: "quick", start: 0.4, end: 0.8 },
      { text: "brown", start: 0.8, end: 1.2 },
      { text: "fox", start: 1.2, end: 1.6 },
      { text: "jumps", start: 1.6, end: 2.0 },
      { text: "over", start: 2.0, end: 2.4 },
      { text: "the", start: 2.4, end: 2.8 },
      { text: "dog", start: 2.8, end: 3.2 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      {
        start: 0.0,
        end: 3.2,
        text: "The quick brown fox jumps over\nthe dog",
      },
    ]);
  });

  it("Too many characters for 2 lines splits into 2 captions at a word boundary", () => {
    const words: Word[] = [
      { text: "One", start: 0.0, end: 0.3 },
      { text: "two", start: 0.3, end: 0.6 },
      { text: "three", start: 0.6, end: 0.9 },
      { text: "four", start: 0.9, end: 1.2 },
      { text: "five", start: 1.2, end: 1.5 },
      { text: "six", start: 1.5, end: 1.8 },
      { text: "seven", start: 1.8, end: 2.1 },
      { text: "eight", start: 2.1, end: 2.4 },
      { text: "nine", start: 2.4, end: 2.7 },
      { text: "ten", start: 2.7, end: 3.0 },
      { text: "eleven", start: 3.0, end: 3.3 },
      { text: "twelve", start: 3.3, end: 3.6 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      {
        start: 0.0,
        end: 3.3,
        text: "One two three four five six\nseven eight nine ten eleven",
      },
      {
        start: 3.3,
        end: 4.0,
        text: "twelve",
      },
    ]);
  });

  it("A 1.5 s pause between words starts a new caption", () => {
    const words: Word[] = [
      { text: "Hello", start: 0.0, end: 1.0 },
      { text: "world", start: 2.5, end: 3.5 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      { start: 0.0, end: 1.0, text: "Hello" },
      { start: 2.5, end: 3.5, text: "world" },
    ]);
  });

  it("A word ending in ? ends the caption", () => {
    const words: Word[] = [
      { text: "Ready?", start: 0.0, end: 0.8 },
      { text: "Let's", start: 0.9, end: 1.4 },
      { text: "go", start: 1.4, end: 2.0 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      { start: 0.0, end: 0.8, text: "Ready?" },
      { start: 0.9, end: 2.0, text: "Let's go" },
    ]);
  });

  it("A 6-second run of words is split before it passes 5 s", () => {
    const words: Word[] = [
      { text: "Word1", start: 0.0, end: 1.0 },
      { text: "Word2", start: 1.0, end: 2.0 },
      { text: "Word3", start: 2.0, end: 3.0 },
      { text: "Word4", start: 3.0, end: 4.0 },
      { text: "Word5", start: 4.0, end: 4.9 },
      { text: "Word6", start: 4.9, end: 6.0 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      { start: 0.0, end: 4.9, text: "Word1 Word2 Word3 Word4 Word5" },
      { start: 4.9, end: 6.0, text: "Word6" },
    ]);
  });

  it("A 45-character word sits alone on its own line, in its own caption", () => {
    const word45 = "a".repeat(45);
    expect(word45.length).toBe(45);

    const words: Word[] = [
      { text: "Short", start: 0.0, end: 0.5 },
      { text: word45, start: 0.6, end: 1.5 },
      { text: "after", start: 1.6, end: 2.0 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      { start: 0.0, end: 0.6, text: "Short" },
      { start: 0.6, end: 1.5, text: word45 },
      { start: 1.6, end: 2.3, text: "after" },
    ]);
  });

  it("A sound cue is dropped by default and kept with includeSoundCues: true", () => {
    const words: Word[] = [
      { text: "Hello", start: 0.0, end: 0.5 },
      { text: "(laughing)", start: 0.5, end: 1.0, kind: "cue" },
      { text: "world", start: 1.0, end: 1.5 },
    ];

    const dropped = buildCaptionCues(words);
    expect(dropped).toEqual([
      { start: 0.0, end: 1.5, text: "Hello world" },
    ]);

    const kept = buildCaptionCues(words, { includeSoundCues: true });
    expect(kept).toEqual([
      { start: 0.0, end: 1.5, text: "Hello (laughing) world" },
    ]);
  });

  it("A 0.2-second one-word caption is extended to 0.7 s, but not past the next caption's start", () => {
    const single = buildCaptionCues([
      { text: "Hi", start: 0.0, end: 0.2 },
    ]);
    expect(single).toEqual([
      { start: 0.0, end: 0.7, text: "Hi" },
    ]);

    const withNext = buildCaptionCues([
      { text: "Hi?", start: 0.0, end: 0.2 },
      { text: "there", start: 0.5, end: 1.5 },
    ]);
    expect(withNext).toEqual([
      { start: 0.0, end: 0.5, text: "Hi?" },
      { start: 0.5, end: 1.5, text: "there" },
    ]);
  });

  it("The exact SRT string for 2 captions, with \\r\\n endings, including a time over 1 hour (01:02:03,456)", () => {
    const cues: CaptionCue[] = [
      { start: 1.0, end: 3.5, text: "First caption\nsecond line" },
      { start: 3723.456, end: 3725.0, text: "Time over one hour" },
    ];

    const srt = toSrt(cues);
    expect(srt).toBe(
      "1\r\n00:00:01,000 --> 00:00:03,500\r\nFirst caption\r\nsecond line\r\n\r\n2\r\n01:02:03,456 --> 01:02:05,000\r\nTime over one hour\r\n\r\n",
    );
  });

  it("The exact VTT string with escaping of &, < and -->", () => {
    const cues: CaptionCue[] = [
      { start: 0.0, end: 2.0, text: "Fish & Chips <tasty> A --> B" },
      { start: 2.0, end: 4.0, text: "Enjoy your meal" },
    ];

    const vtt = toVtt(cues);
    expect(vtt).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFish &amp; Chips &lt;tasty&gt; A → B\n\n00:00:02.000 --> 00:00:04.000\nEnjoy your meal\n\n",
    );
  });

  it("Splits Hindi sentences on Devanagari Purna Viram (।) and Deergh Viram (॥)", () => {
    const words: Word[] = [
      { text: "नमस्ते", start: 0.0, end: 0.5 },
      { text: "दोस्तों।", start: 0.5, end: 1.0 },
      { text: "आज", start: 1.2, end: 1.5 },
      { text: "हम", start: 1.5, end: 1.8 },
      { text: "सीखेंगे॥", start: 1.8, end: 2.3 },
      { text: "अगला", start: 2.5, end: 2.8 },
      { text: "भाग", start: 2.8, end: 3.2 },
    ];

    const cues = buildCaptionCues(words);
    expect(cues).toEqual([
      { start: 0.0, end: 1.0, text: "नमस्ते दोस्तों।" },
      { start: 1.2, end: 2.3, text: "आज हम सीखेंगे॥" },
      { start: 2.5, end: 3.2, text: "अगला भाग" },
    ]);
  });

  it('Empty input gives [], then "" (SRT) and "WEBVTT\\n" (VTT)', () => {
    const cues = buildCaptionCues([]);
    expect(cues).toEqual([]);

    expect(toSrt(cues)).toBe("");
    expect(toVtt(cues)).toBe("WEBVTT\n");
  });
});
