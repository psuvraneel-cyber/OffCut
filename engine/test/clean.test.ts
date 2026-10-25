import { describe, expect, it } from "vitest";
import { cleanSegments, cleanWords, groupWordsIntoSegments, normalizeWords, stripSpeakerDash } from "../src/whisper/clean";

describe("clean transcript text", () => {
  it("removes artefacts (including [BLANK_AUDIO] and [blank_audio]), merges continuation tokens, clamps timestamps, and drops empties", () => {
    const words = cleanWords(
      [
        { text: " [Music] ", start: -1, end: 1 },
        { text: " [BLANK_AUDIO] ", start: 0.5, end: 1 },
        { text: " [blank_audio] ", start: 0.7, end: 1.1 },
        { text: " Hel", start: 1, end: 1.2 },
        { text: "lo", start: 1.2, end: 1.5 },
        { text: " world ", start: 1.5, end: 2.1 },
        { text: "", start: 2, end: 3 },
        { text: "(applause)", start: 3, end: 4 },
        { text: " end", start: 8, end: 12 },
      ],
      10,
    );

    expect(words).toEqual([
      { text: "Hello", start: 1, end: 1.5 },
      { text: "world", start: 1.5, end: 2.1 },
      { text: "end", start: 8, end: 10 },
    ]);
  });

  it("zero-length input words get a positive length when there's room", () => {
    const words = normalizeWords(
      [
        { text: "zero", start: 3.52, end: 3.52 },
        { text: "next", start: 4.0, end: 4.5 },
      ],
      10,
    );

    expect(words[0].text).toBe("zero");
    expect(words[0].end - words[0].start).toBeGreaterThanOrEqual(0.08);
    expect(words[0].start).toBe(3.52);
    expect(words[0].end).toBeCloseTo(3.6, 2);
    expect(words[0].end).toBeLessThanOrEqual(words[1].start);
  });

  it("output is sorted with no overlaps, and every word has start <= end", () => {
    const words = normalizeWords(
      [
        { text: "third", start: 5, end: 6 },
        { text: "first", start: 1, end: 2 },
        { text: "overlap", start: 1.8, end: 3 },
      ],
      10,
    );

    expect(words.map((w) => w.text)).toEqual(["first", "overlap", "third"]);
    for (let index = 0; index < words.length; index += 1) {
      expect(words[index].start).toBeLessThanOrEqual(words[index].end);
      if (index > 0) {
        expect(words[index].start).toBeGreaterThanOrEqual(words[index - 1].end);
      }
    }
  });

  it("creates approximate words for segment-only output", () => {
    const segments = cleanSegments([{ text: "hello world", start: -1, end: 4 }], 3);
    expect(segments[0].text).toBe("hello world");
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(3);
    expect(segments[0].words).toHaveLength(2);
    expect(segments[0].words[0].start).toBe(0);
    expect(segments[0].words[1].end).toBe(3);
  });

  it("groupWordsIntoSegments groups on sentence punctuation and pauses", () => {
    const words = [
      { text: "Hello.", start: 1.0, end: 1.5 },
      { text: "How", start: 1.6, end: 1.8 },
      { text: "are", start: 1.85, end: 2.0 },
      { text: "you?", start: 2.05, end: 2.3 },
      { text: "Pause", start: 4.0, end: 4.4 },
    ];
    const segments = groupWordsIntoSegments(words);
    expect(segments).toHaveLength(3);
    expect(segments[0].text).toBe("Hello.");
    expect(segments[1].text).toBe("How are you?");
    expect(segments[2].text).toBe("Pause");
  });
});

describe("speaker-change dashes", () => {
  it("strips a leading dash before a word, with or without a space", () => {
    expect(stripSpeakerDash("- Oh!")).toBe("Oh!");
    expect(stripSpeakerDash("- I'm")).toBe("I'm");
    expect(stripSpeakerDash("-Yeah")).toBe("Yeah");
    expect(stripSpeakerDash("— Okay.")).toBe("Okay.");
  });

  it("keeps dashes that are part of the word", () => {
    expect(stripSpeakerDash("flip-o")).toBe("flip-o");
    expect(stripSpeakerDash("-5")).toBe("-5");
    expect(stripSpeakerDash("well-known")).toBe("well-known");
  });

  it("removes the dash from cleaned words and drops dash-only words", () => {
    const words = cleanWords(
      [
        { text: " - Oh!", start: 0, end: 0.4 },
        { text: " -", start: 0.4, end: 0.5 },
        { text: " The", start: 0.5, end: 0.8 },
      ],
      5,
    );
    expect(words.map((w) => w.text)).toEqual(["Oh!", "The"]);
  });
});
