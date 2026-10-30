import { describe, expect, it } from "vitest";
import {
  devanagariWordToPhoneticRoman,
  normalizeForScoring,
  wordErrors,
} from "../bench/wer";
import {
  buildSampleBenchResult,
  computeCategorySummaries,
  computeSourceSummaries,
  getSourceDataset,
  selectReferenceForSample,
  type EvalItem,
  type ManifestSample,
} from "../bench/main";
import type { Transcript } from "../src/types";

describe("Phase 2 P1.1 Benchmark Architecture & Scorer Verification", () => {
  describe("1. Source dataset identification", () => {
    it("identifies Common Voice Hindi from sample ID prefix", () => {
      expect(getSourceDataset("HI_CV_0001")).toBe("common_voice_hindi");
    });

    it("identifies Kathbath Hindi from sample ID prefix", () => {
      expect(getSourceDataset("HI_KB_0012")).toBe("kathbath_hindi");
    });

    it("identifies MUCS 2021 Hindi-English from sample ID prefix", () => {
      expect(getSourceDataset("HINGLISH_MUCS_0045")).toBe("mucs_2021_hindi_english");
    });

    it("identifies NPR Podcast from sample ID prefix", () => {
      expect(getSourceDataset("EN_PODCAST_001")).toBe("npr_podcast");
    });

    it("prefers manifest explicit source name when provided", () => {
      expect(getSourceDataset("CUSTOM_SAMPLE_99", "custom_corpus")).toBe("custom_corpus");
    });
  });

  describe("2. Reference selection and verification propagation", () => {
    const mockRefMap = new Map<string, string>([
      ["processed/hindi/references/HI_CV_0001.txt", "यह एक परीक्षण है"],
      ["processed/hinglish/references/HINGLISH_MUCS_0001.txt", "अब accounts के नीचे click करें"],
      ["processed/hinglish/references/HINGLISH_MUCS_0001_roman.txt", "ab accounts ke neeche click karein"],
    ]);

    it("propagates unverified status for P1.0 curated Hindi samples", () => {
      const sample: ManifestSample = {
        sample_id: "HI_CV_0001",
        category: "02_hindi",
        language: "hi",
        audio_standardized_path: "processed/hindi/audio/HI_CV_0001.wav",
        transcript_reference_path: "processed/hindi/references/HI_CV_0001.txt",
        duration_seconds: 5.0,
        references: {
          hindi_devanagari: {
            path: "processed/hindi/references/HI_CV_0001.txt",
            script: "devanagari",
            output_profile: "hindi_devanagari",
            verified: false,
          },
        },
      };

      const ref = selectReferenceForSample(sample, "hi", mockRefMap);
      expect(ref.profile).toBe("hindi_devanagari");
      expect(ref.verified).toBe(false);
      expect(ref.text).toBe("यह एक परीक्षण है");
    });

    it("resolves companion _roman.txt reference for Hinglish and respects unverified flag", () => {
      const sample: ManifestSample = {
        sample_id: "HINGLISH_MUCS_0001",
        category: "03_hinglish",
        language: "hi",
        audio_standardized_path: "processed/hinglish/audio/HINGLISH_MUCS_0001.wav",
        transcript_reference_path: "processed/hinglish/references/HINGLISH_MUCS_0001.txt",
        duration_seconds: 6.2,
        references: {
          hinglish_roman: {
            path: "processed/hinglish/references/HINGLISH_MUCS_0001_roman.txt",
            script: "romanized_hinglish",
            output_profile: "hinglish_roman",
            verified: false,
          },
        },
      };

      const ref = selectReferenceForSample(sample, "hinglish", mockRefMap);
      expect(ref.profile).toBe("hinglish_roman");
      expect(ref.verified).toBe(false);
      expect(ref.text).toBe("ab accounts ke neeche click karein");
    });
  });

  describe("3. Script normalization and phonetic Roman mapping", () => {
    it("converts Devanagari words phonetically while preserving Latin words", () => {
      const source = "अब accounts के नीचे click करें";
      const normalized = normalizeForScoring(source, "hinglish_script_normalized");
      expect(normalized).toContain("accounts");
      expect(normalized).toContain("click");
      expect(normalized).not.toMatch(/[\u0900-\u097F]/);
    });

    it("handles common Devanagari syllables correctly", () => {
      expect(devanagariWordToPhoneticRoman("भारत")).toBe("bharat");
      expect(devanagariWordToPhoneticRoman("नमस्ते")).toBe("namaste");
    });
  });

  describe("4. Hinglish multi-profile scoring from single inference", () => {
    const verbatimRef = "अब accounts के नीचे click करें";
    const romanRef = "ab accounts ke neeche click karein";
    const hypothesis = "ab accounts ke neeche click karein";

    it("measures zero or low WER when scored against Romanized reference", () => {
      const werRoman = wordErrors(romanRef, hypothesis, "hinglish_roman");
      expect(werRoman.wer).toBe(0);
    });

    it("correctly identifies script mismatch when scored against verbatim mixed-script reference", () => {
      const werVerbatim = wordErrors(verbatimRef, hypothesis, "hinglish_mixed_verbatim");
      // Hypothesis is in Latin, verbatim ref has Devanagari tokens ("अब", "के", "नीचे", "करें")
      // so substitutions will occur on the Devanagari words
      expect(werVerbatim.wer).toBeGreaterThan(0);
      expect(werVerbatim.substitutions).toBeGreaterThan(0);
    });

    it("script-normalized profile bridges the orthographic gap without circular transliteration", () => {
      const werNorm = wordErrors(verbatimRef, hypothesis, "hinglish_script_normalized");
      // Script-normalized maps Devanagari tokens in reference to phonetic Roman tokens
      // bridging the script gap
      expect(werNorm.wer).toBeLessThan(wordErrors(verbatimRef, hypothesis, "hinglish_mixed_verbatim").wer);
    });
  });

  describe("5. Category and Source Summaries Aggregation", () => {
    const dummyTranscript: Transcript = {
      language: "hi",
      duration: 5.0,
      granularity: "word",
      segments: [],
      words: [{ text: "sample", start: 0, end: 1 }],
      stats: {
        model: "tiny",
        device: "webgpu",
        dtype: "fp16",
        loadMs: 100,
        decodeMs: 50,
        transcribeMs: 250,
        realTimeFactor: 0.05,
        vad: "silero",
        windows: 1,
        retriedWindows: 0,
      },
    };

    const mockItemHiCV: EvalItem = {
      id: "HI_CV_0001",
      category: "02_hindi",
      sourceDataset: "common_voice_hindi",
      language: "hi",
      audioUrl: "/eval/processed/hindi/audio/HI_CV_0001.wav",
      referenceText: "यह परीक्षण है",
      durationSeconds: 5.0,
      profile: "hindi_devanagari",
      referenceVerified: false,
      referenceId: "hindi_devanagari",
    };

    const mockItemHiKB: EvalItem = {
      id: "HI_KB_0001",
      category: "02_hindi",
      sourceDataset: "kathbath_hindi",
      language: "hi",
      audioUrl: "/eval/processed/hindi/audio/HI_KB_0001.wav",
      referenceText: "दूसरा परीक्षण है",
      durationSeconds: 5.0,
      profile: "hindi_devanagari",
      referenceVerified: false,
      referenceId: "hindi_devanagari",
    };

    it("correctly separates sources in source summaries while combining in category summaries", () => {
      const res1 = buildSampleBenchResult(1, mockItemHiCV, "hindi_devanagari", "यह परीक्षण है", "यह परीक्षण है", dummyTranscript, 250, "common_voice_hindi");
      const res2 = buildSampleBenchResult(1, mockItemHiKB, "hindi_devanagari", "दूसरा परीक्षण है", "दूसरा परीक्षण था", dummyTranscript, 300, "kathbath_hindi");

      const results = [res1, res2];

      const catSummaries = computeCategorySummaries(results);
      expect(catSummaries.length).toBe(1);
      expect(catSummaries[0].category).toBe("02_hindi");
      expect(catSummaries[0].samples).toBe(2);

      const srcSummaries = computeSourceSummaries(results);
      expect(srcSummaries.length).toBe(2);
      const cvSum = srcSummaries.find((s) => s.groupKey.includes("common_voice_hindi"))!;
      const kbSum = srcSummaries.find((s) => s.groupKey.includes("kathbath_hindi"))!;

      expect(cvSum).toBeDefined();
      expect(cvSum.samples).toBe(1);
      expect(cvSum.microWer).toBe(0);

      expect(kbSum).toBeDefined();
      expect(kbSum.samples).toBe(1);
      expect(kbSum.microWer).toBeGreaterThan(0);
    });
  });

  describe("6. Error handling on failed samples", () => {
    it("builds fallback sample result safely without throwing", () => {
      const fallbackTranscript: Transcript = {
        language: "hi",
        duration: 10.0,
        granularity: "word",
        segments: [],
        words: [],
        stats: {
          model: "tiny",
          device: "webgpu",
          dtype: "unknown",
          loadMs: 50,
          decodeMs: 0,
          transcribeMs: 100,
          realTimeFactor: 0,
          windows: 0,
          retriedWindows: 0,
        },
      };

      const mockItem: EvalItem = {
        id: "HI_FAILED_001",
        category: "02_hindi",
        language: "hi",
        audioUrl: "/missing.wav",
        referenceText: "यह कभी ट्रांसक्राइब नहीं हुआ",
        durationSeconds: 10.0,
        profile: "hindi_devanagari",
        referenceVerified: false,
        referenceId: "hindi_devanagari",
      };

      const result = buildSampleBenchResult(
        1,
        mockItem,
        "hindi_devanagari",
        mockItem.referenceText,
        "",
        fallbackTranscript,
        100,
      );

      expect(result.id).toBe("HI_FAILED_001");
      expect(result.hypothesisText).toBe("");
      expect(result.wordErrors.deletions).toBe(5);
      expect(result.deletionRate).toBe(1.0);
    });
  });
});
