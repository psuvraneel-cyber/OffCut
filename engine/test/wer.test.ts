import { describe, expect, it } from "vitest";
import { charErrors, normalizeForScoring, wordErrors } from "../bench/wer";

describe("scoring and text normalization", () => {
  it("normalizes run-on NPR podcast string with cues and speaker labels", () => {
    const runOn = "NPR.[COIN SPINNING]KEITH ROMER: Over the last few months, US-China trade relations have been kind of bizarre.";
    const normalized = normalizeForScoring(runOn);
    expect(normalized).toBe("npr over the last few months us china trade relations have been kind of bizarre");

    const fullStart = "ANNOUNCER: This is Planet Money from NPR.[COIN SPINNING]KEITH ROMER: Over";
    expect(normalizeForScoring(fullStart)).toBe("this is planet money from npr over");
  });

  it("normalizes tokenized vlog string rejoining split contractions", () => {
    const vlog = "So I 'm literally … you guys .";
    expect(normalizeForScoring(vlog)).toBe("so i'm literally you guys");
  });

  it("normalizes Devanagari sentences with । and ॥", () => {
    const devanagari = "यह एक परीक्षण वाक्य है। दूसरा वाक्य॥";
    expect(normalizeForScoring(devanagari)).toBe("यह एक परीक्षण वाक्य है दूसरा वाक्य");
  });

  it("normalizes mixed-script text with percentage, digits, and apostrophes", () => {
    const mixed = "यह एक test वाक्य है, 50% discount के साथ! 'quoted' and don't stop.";
    expect(normalizeForScoring(mixed)).toBe("यह एक test वाक्य है 50% discount के साथ quoted and don't stop");
  });

  it("computes word errors accurately", () => {
    const ref = "the quick brown fox";
    const hypMatch = "the quick brown fox";
    expect(wordErrors(ref, hypMatch)).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      referenceWords: 4,
      wer: 0,
    });

    const hypSub = "the fast brown fox";
    expect(wordErrors(ref, hypSub)).toEqual({
      substitutions: 1,
      deletions: 0,
      insertions: 0,
      referenceWords: 4,
      wer: 0.25,
    });

    const hypDel = "the fox";
    expect(wordErrors(ref, hypDel)).toEqual({
      substitutions: 0,
      deletions: 2,
      insertions: 0,
      referenceWords: 4,
      wer: 0.5,
    });

    const hypIns = "the quick brown fox jumps";
    expect(wordErrors(ref, hypIns)).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 1,
      referenceWords: 4,
      wer: 0.25,
    });
  });

  it("computes character errors on Devanagari and Latin text", () => {
    const ref = "परीक्षण";
    const hyp = "परिक्षण";
    const res = charErrors(ref, hyp);
    expect(res.referenceChars).toBe(Array.from(normalizeForScoring(ref).replace(/\s+/g, "")).length);
    expect(res.substitutions).toBe(1);
    expect(res.deletions).toBe(0);
    expect(res.insertions).toBe(0);
    expect(res.cer).toBeGreaterThan(0);
  });

  it("handles empty references and hypotheses cleanly", () => {
    expect(wordErrors("", "")).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      referenceWords: 0,
      wer: 0,
    });

    expect(wordErrors("hello world", "")).toEqual({
      substitutions: 0,
      deletions: 2,
      insertions: 0,
      referenceWords: 2,
      wer: 1.0,
    });

    expect(wordErrors("", "extra words")).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 2,
      referenceWords: 0,
      wer: 1.0,
    });
  });
});
