import { describe, it, expect } from "vitest";
import {
  validateCandidateTranscript,
  hasSingleTokenDominance,
} from "../src/whisper/retry";
import type { WindowTranscript } from "../src/types";

describe("Recovery Ladder & Candidate Validation (Phase 2 P0.1)", () => {
  const dummyWindow = { index: 0, start: 0, end: 10 };

  it("rejects candidate transcripts containing repetition loops", () => {
    const loopCandidate: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hi",
      segments: [],
      words: [
        { text: "तो", start: 0, end: 0.5 },
        { text: "तो", start: 0.5, end: 1.0 },
        { text: "तो", start: 1.0, end: 1.5 },
        { text: "तो", start: 1.5, end: 2.0 },
        { text: "तो", start: 2.0, end: 2.5 },
      ],
    };
    const val = validateCandidateTranscript(loopCandidate, "hi", 3.0);
    expect(val.valid).toBe(false);
    expect(val.hasLoop).toBe(true);
    expect(val.reason).toContain("repetition loop");
  });

  it("rejects candidate transcripts with single-token dominance", () => {
    // 5 out of 8 tokens are "पाट" (62.5% > 60%), with no 4-consecutive repetition loop
    const dominantCandidate: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hi",
      segments: [],
      words: [
        { text: "पाट", start: 0, end: 0.5 },
        { text: "नमस्ते", start: 0.5, end: 1.0 },
        { text: "पाट", start: 1.0, end: 1.5 },
        { text: "धन्यवाद", start: 1.5, end: 2.0 },
        { text: "पाट", start: 2.0, end: 2.5 },
        { text: "शुभ", start: 2.5, end: 3.0 },
        { text: "पाट", start: 3.0, end: 3.5 },
        { text: "पाट", start: 3.5, end: 4.0 },
      ],
    };
    const val = validateCandidateTranscript(dominantCandidate, "hi", 4.0);
    expect(val.valid).toBe(false);
    expect(val.singleTokenDominance).toBe(true);
    expect(val.reason).toContain("single token dominance");
  });

  it("rejects candidate transcripts containing forbidden foreign script (e.g. CJK hallucination)", () => {
    // In our forensic investigation, Whisper produced Chinese characters: sucha,似乎似乎
    const cjkCandidate: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hi",
      segments: [],
      words: [
        { text: "sucha", start: 0, end: 0.5 },
        { text: "似乎", start: 0.5, end: 1.0 },
        { text: "mein", start: 1.0, end: 1.5 },
      ],
    };
    const val = validateCandidateTranscript(cjkCandidate, "hi", 2.0);
    expect(val.valid).toBe(false);
    expect(val.foreignCount).toBeGreaterThan(0);
    expect(val.reason).toContain("forbidden foreign script");
  });

  it("rejects candidate transcripts with high junk word ratio (>25%)", () => {
    const junkCandidate: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "en",
      segments: [],
      words: [
        { text: "...", start: 0, end: 0.5 },
        { text: "hello", start: 0.5, end: 1.0 },
        { text: "world", start: 1.0, end: 1.5 },
        { text: "---", start: 1.5, end: 2.0 },
      ],
    };
    // 2 junk words ("...", "---") out of 4 = 50% > 25%
    const val = validateCandidateTranscript(junkCandidate, "en", 2.0);
    expect(val.valid).toBe(false);
    expect(val.junkCount).toBe(2);
    expect(val.reason).toContain("high junk word ratio");
  });

  it("rejects empty candidate transcript when speech is present (>=2s)", () => {
    const emptyCandidate: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hi",
      segments: [],
      words: [],
    };
    const val = validateCandidateTranscript(emptyCandidate, "hi", 3.5);
    expect(val.valid).toBe(false);
    expect(val.reason).toBe("empty output on speech");
  });

  it("accepts structurally clean Hindi Devanagari candidate transcript", () => {
    const cleanHindi: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hi",
      segments: [],
      words: [
        { text: "यह", start: 0, end: 0.5 },
        { text: "एक", start: 0.5, end: 1.0 },
        { text: "परीक्षण", start: 1.0, end: 1.5 },
        { text: "है", start: 1.5, end: 2.0 },
      ],
    };
    const val = validateCandidateTranscript(cleanHindi, "hi", 2.0);
    expect(val.valid).toBe(true);
    expect(val.tokenCount).toBe(4);
    expect(val.junkCount).toBe(0);
    expect(val.foreignCount).toBe(0);
    expect(val.reason).toBe("structurally clean");
  });

  it("accepts structurally clean Hinglish code-switched candidate transcript", () => {
    const cleanHinglish: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hinglish",
      segments: [],
      words: [
        { text: "aaj", start: 0, end: 0.5 },
        { text: "ka", start: 0.5, end: 1.0 },
        { text: "weather", start: 1.0, end: 1.5 },
        { text: "bohot", start: 1.5, end: 2.0 },
        { text: "good", start: 2.0, end: 2.5 },
        { text: "hai", start: 2.5, end: 3.0 },
      ],
    };
    const val = validateCandidateTranscript(cleanHinglish, "hinglish", 3.0);
    expect(val.valid).toBe(true);
    expect(val.tokenCount).toBe(6);
    expect(val.junkCount).toBe(0);
    expect(val.foreignCount).toBe(0);
  });

  it("handles hasSingleTokenDominance threshold and length checks", () => {
    // Fewer than minTokens (6) should return false
    expect(hasSingleTokenDominance(["a", "a", "a"], 0.6, 6)).toBe(false);
    // 4 out of 6 is 66.7% > 60%
    expect(hasSingleTokenDominance(["to", "to", "to", "to", "kya", "hua"], 0.6, 6)).toBe(true);
    // 3 out of 6 is 50% < 60%
    expect(hasSingleTokenDominance(["to", "to", "to", "kya", "hua", "bhai"], 0.6, 6)).toBe(false);
  });

  it("ensures candidate validation rejects CJK/Cyrillic mixed tokens", () => {
    const hybridCandidate: WindowTranscript = {
      window: dummyWindow,
      granularity: "word",
      language: "hi",
      segments: [],
      words: [
        { text: "हम", start: 0, end: 0.5 },
        { text: "र議", start: 0.5, end: 1.0 },
        { text: "गए", start: 1.0, end: 1.5 },
      ],
    };
    const val = validateCandidateTranscript(hybridCandidate, "hi", 1.5);
    expect(val.valid).toBe(false);
    expect(val.foreignCount).toBe(1);
    expect(val.reason).toContain("forbidden foreign script");
  });
});
