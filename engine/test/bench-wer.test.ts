import { describe, expect, it } from "vitest";
import {
  analyzeScript,
  detailedCharErrors,
  detailedWordErrors,
  normalizeForScoring,
  wordErrors,
} from "../bench/wer";
import {
  computeCategorySummaries,
  selectReferenceForSample,
  type ManifestSample,
  type SampleBenchResult,
} from "../bench/main";

describe("Phase 1 Benchmark Evaluation Architecture", () => {
  describe("A. Reference selection logic", () => {
    const mockRefMap = new Map<string, string>([
      ["02_hindi/transcripts/HI_INDIC_001_reference.txt", "कहे जो है अंकल हाई इस्कूल नाइन्थ टेंथ की किताबें चाहे रहे"],
      ["03_hinglish/transcripts/HINGLISH_COSHE_001_reference.txt", "हैं ना कि you are high on your own supply वैसा वाला हो गया है"],
      ["03_hinglish/transcripts/HINGLISH_COSHE_001_roman_reference.txt", "hain na ki you are high on your own supply waisa wala ho gaya hai"],
      ["01_english_podcast/transcripts/reference.txt", "Over the last few months, US-China trade relations have been bizarre."],
    ]);

    const mockHindiSample: ManifestSample = {
      sample_id: "HI_INDIC_001",
      category: "02_hindi",
      language: "hi",
      audio_standardized_path: "02_hindi/audio/standardized/HI_INDIC_001.wav",
      transcript_reference_path: "02_hindi/transcripts/HI_INDIC_001_reference.txt",
      duration_seconds: 4.5,
      references: {
        hindi_devanagari: {
          path: "02_hindi/transcripts/HI_INDIC_001_reference.txt",
          script: "devanagari",
          output_profile: "hindi_devanagari",
          verified: true,
        },
      },
    };

    const mockHinglishSample: ManifestSample = {
      sample_id: "HINGLISH_COSHE_001",
      category: "03_hinglish",
      language: "hi",
      audio_standardized_path: "03_hinglish/audio/standardized/HINGLISH_COSHE_001.wav",
      transcript_reference_path: "03_hinglish/transcripts/HINGLISH_COSHE_001_reference.txt",
      duration_seconds: 19.3,
      references: {
        mixed_diagnostic: {
          path: "03_hinglish/transcripts/HINGLISH_COSHE_001_reference.txt",
          script: "mixed",
          output_profile: "mixed_diagnostic",
          verified: true,
        },
        hinglish_roman: {
          path: "03_hinglish/transcripts/HINGLISH_COSHE_001_roman_reference.txt",
          script: "romanized_hinglish",
          output_profile: "hinglish_roman",
          verified: true,
        },
      },
    };

    it("selects verified Devanagari reference for Hindi mode", () => {
      const res = selectReferenceForSample(mockHindiSample, "hi", mockRefMap);
      expect(res.profile).toBe("hindi_devanagari");
      expect(res.verified).toBe(true);
      expect(res.text).toContain("कहे जो है अंकल");
    });

    it("selects verified Romanized Hinglish reference for Hinglish mode", () => {
      const res = selectReferenceForSample(mockHinglishSample, "hinglish", mockRefMap);
      expect(res.profile).toBe("hinglish_roman");
      expect(res.verified).toBe(true);
      expect(res.text).toContain("hain na ki you are high on your own supply");
      expect(res.text).not.toMatch(/[\u0900-\u097F]/);
    });

    it("selects mixed diagnostic reference for auto mode on Hinglish audio", () => {
      const res = selectReferenceForSample(mockHinglishSample, "auto", mockRefMap);
      expect(res.profile).toBe("mixed_diagnostic");
      expect(res.verified).toBe(true);
      expect(res.text).toContain("हैं ना कि");
    });

    it("marks fallback reference unverified when Roman reference is missing", () => {
      const incompleteSample: ManifestSample = {
        sample_id: "HINGLISH_MISSING",
        category: "03_hinglish",
        language: "hi",
        audio_standardized_path: "03_hinglish/missing.wav",
        transcript_reference_path: "03_hinglish/transcripts/missing_reference.txt",
        duration_seconds: 10.0,
      };
      const res = selectReferenceForSample(incompleteSample, "hinglish", mockRefMap);
      expect(res.profile).toBe("hinglish_roman");
      expect(res.verified).toBe(false);
      expect(res.refId).toBe("unverified_fallback");
    });
  });

  describe("B. Hinglish normalization and strict scoring", () => {
    it("yields zero WER on matching Romanized Hinglish with case and punctuation differences", () => {
      const ref = "Actually mujhe lagta hai this approach will work much better.";
      const hyp = "actually mujhe lagta hai this approach will work much better";
      const res = wordErrors(ref, hyp, "hinglish_roman");
      expect(res.wer).toBe(0);
      expect(res.substitutions).toBe(0);
      expect(res.deletions).toBe(0);
      expect(res.insertions).toBe(0);
    });

    it("preserves apostrophes inside English contractions in Romanized Hinglish", () => {
      const ref = "Dont get married if you can't handle responsibilities.";
      const hyp = "dont get married if you can't handle responsibilities";
      const normRef = normalizeForScoring(ref, "hinglish_roman");
      const normHyp = normalizeForScoring(hyp, "hinglish_roman");
      expect(normRef).toBe("dont get married if you can't handle responsibilities");
      expect(normHyp).toBe("dont get married if you can't handle responsibilities");
      expect(wordErrors(ref, hyp, "hinglish_roman").wer).toBe(0);
    });

    it("strictly penalizes Devanagari output against Romanized Hinglish reference", () => {
      const ref = "Main kal office gaya tha.";
      const hyp = "मैं कल office गया था।";
      const res = wordErrors(ref, hyp, "hinglish_roman");
      // "main kal gaya tha" (4 words) are Devanagari in hyp ("मैं कल गया था")
      // Only "office" matches!
      expect(res.substitutions).toBe(4);
      expect(res.wer).toBe(4 / 5); // 80% WER
    });
  });

  describe("C. Hindi normalization and script preservation", () => {
    it("preserves Devanagari letters, matras, anusvara, and nukta while stripping Purna Viram", () => {
      const hindi = "यह एक परीक्षण वाक्य है। उन्होंने कहा कि डॉक्टर आएँगे॥";
      const norm = normalizeForScoring(hindi, "hindi_devanagari");
      expect(norm).toBe("यह एक परीक्षण वाक्य है उन्होंने कहा कि डॉक्टर आएँगे");
      expect(norm).not.toContain("।");
      expect(norm).not.toContain("॥");
    });

    it("normalizes ZWJ and ZWNJ in Devanagari without deleting word tokens", () => {
      const withZwnj = "क\u200Cह\u200Dना";
      const withoutZwnj = "कहना";
      expect(normalizeForScoring(withZwnj, "hindi_devanagari")).toBe(withoutZwnj);
    });

    it("preserves Latin loanwords and numbers within Hindi sentences", () => {
      const mixed = "यहाँ 50% discount मिलेगा, check out this offer!";
      const norm = normalizeForScoring(mixed, "hindi_devanagari");
      expect(norm).toBe("यहाँ 50% discount मिलेगा check out this offer");
    });
  });

  describe("D. English regression normalization", () => {
    it("correctly handles contractions, speaker labels, cues, and dashes", () => {
      const podcast = "KEITH ROMER: I'm not sure -- well, it's 100% true! [LAUGHTER]";
      const norm = normalizeForScoring(podcast, "english_latin");
      expect(norm).toBe("i'm not sure well it's 100% true");
    });
  });

  describe("E. Mathematical invariants of WER and CER", () => {
    it("computes exact edit breakdown on substitutions, deletions, and insertions", () => {
      const ref = "one two three four five";
      const hyp = "one substitution four five insertion";
      const res = detailedWordErrors(ref, hyp, "english_latin");
      expect(res.referenceWords).toBe(5);
      expect(res.substitutions).toBe(1); // two -> substitution
      expect(res.deletions).toBe(1); // three deleted
      expect(res.insertions).toBe(1); // insertion added
      expect(res.wer).toBe(3 / 5);
      expect(res.deletionRate).toBe(1 / 5);
      expect(res.insertionRate).toBe(1 / 5);
      expect(res.substitutionRate).toBe(1 / 5);
      expect(res.accuracy).toBeCloseTo(2 / 5);
    });

    it("allows WER to exceed 100% when insertions exceed reference words", () => {
      const ref = "two words";
      const hyp = "two words extra one extra two extra three";
      const res = wordErrors(ref, hyp, "english_latin");
      expect(res.referenceWords).toBe(2);
      expect(res.insertions).toBe(6);
      expect(res.wer).toBe(3.0); // 300% WER
    });

    it("handles edge cases: empty reference and empty hypothesis", () => {
      expect(wordErrors("", "", "english_latin").wer).toBe(0);
      expect(wordErrors("some words", "", "english_latin").wer).toBe(1.0);
      expect(wordErrors("", "unsolicited words", "english_latin").wer).toBe(1.0);
    });

    it("evaluates CER with grapheme clusters for Indic characters", () => {
      const ref = "परीक्षण";
      const hyp = "परिक्षण";
      const res = detailedCharErrors(ref, hyp, "hindi_devanagari");
      expect(res.referenceChars).toBe(7); // codepoint length
      expect(res.substitutions).toBe(1); // ी vs ि
      expect(res.cer).toBeCloseTo(1 / 7);
      if (res.graphemeErrors) {
        expect(res.graphemeErrors.referenceChars).toBe(4); // प, री, क्ष, ण
        expect(res.graphemeErrors.substitutions).toBe(1); // री vs रि
        expect(res.graphemeErrors.cer).toBe(0.25);
      }
    });
  });

  describe("F. Script diagnostics", () => {
    it("identifies pure Devanagari text", () => {
      const diag = analyzeScript("नमस्ते दुनिया आप कैसे हैं", "hindi_devanagari");
      expect(diag.dominantScript).toBe("devanagari");
      expect(diag.devanagariChars).toBeGreaterThan(15);
      expect(diag.latinChars).toBe(0);
      expect(diag.persoArabicChars).toBe(0);
      expect(diag.hasCorruptedUnicode).toBe(false);
    });

    it("identifies pure Latin text", () => {
      const diag = analyzeScript("This is an english sentence.", "english_latin");
      expect(diag.dominantScript).toBe("latin");
      expect(diag.latinChars).toBeGreaterThan(15);
      expect(diag.devanagariChars).toBe(0);
      expect(diag.expectedScriptMatchRate).toBe(1.0);
    });

    it("identifies Perso-Arabic (Urdu) drift", () => {
      const diag = analyzeScript("کہہیں کہہیں امکا ہے اس کول", "hindi_devanagari");
      expect(diag.dominantScript).toBe("perso_arabic");
      expect(diag.persoArabicChars).toBeGreaterThan(10);
      expect(diag.devanagariChars).toBe(0);
    });

    it("detects Unicode replacement character corruption and dangling marks", () => {
      const diag = analyzeScript("pra\uFFFDpagainda \u093Etest", "hinglish_roman");
      expect(diag.replacementChars).toBe(1);
      expect(diag.suspiciousMarks).toBe(1);
      expect(diag.hasCorruptedUnicode).toBe(true);
    });
  });

  describe("G. Category and mode aggregation", () => {
    const dummyStats = {
      model: "tiny" as const,
      device: "wasm" as const,
      dtype: "q8",
      loadMs: 100,
      decodeMs: 50,
      transcribeMs: 500,
      realTimeFactor: 1.0,
      vad: "silero" as const,
      windows: 1,
      retriedWindows: 0,
    };

    const mockResults: SampleBenchResult[] = [
      {
        runIndex: 1,
        id: "SAMPLE_1",
        category: "03_hinglish",
        language: "hinglish",
        scoringProfile: "hinglish_roman",
        duration: 10,
        detectedLanguage: "hi",
        referenceVerified: true,
        referenceId: "hinglish_roman",
        wordErrors: { substitutions: 1, deletions: 1, insertions: 0, referenceWords: 10, wer: 0.2 },
        detailedWordErrors: { substitutions: 1, deletions: 1, insertions: 0, referenceWords: 10, wer: 0.2, deletionRate: 0.1, insertionRate: 0, substitutionRate: 0.1, accuracy: 0.8 },
        charErrors: { substitutions: 2, deletions: 2, insertions: 0, referenceChars: 50, cer: 0.08 },
        detailedCharErrors: { substitutions: 2, deletions: 2, insertions: 0, referenceChars: 50, cer: 0.08 },
        scriptDiagnostics: { devanagariChars: 0, latinChars: 40, persoArabicChars: 0, otherChars: 0, totalLetters: 40, replacementChars: 0, suspiciousMarks: 0, dominantScript: "latin", expectedScriptMatchRate: 1.0, hasCorruptedUnicode: false },
        deletionRate: 0.1,
        maxGapSeconds: 0.5,
        wordsInSilence: 0,
        wallTimeMs: 5000,
        rtf: 0.5,
        stats: dummyStats,
        hypothesisText: "hyp text 1",
        normalizedReference: "ref text 1",
        normalizedHypothesis: "hyp text 1",
      },
      {
        runIndex: 1,
        id: "SAMPLE_2",
        category: "03_hinglish",
        language: "hinglish",
        scoringProfile: "hinglish_roman",
        duration: 20,
        detectedLanguage: "hi",
        referenceVerified: true,
        referenceId: "hinglish_roman",
        wordErrors: { substitutions: 4, deletions: 2, insertions: 0, referenceWords: 20, wer: 0.3 },
        detailedWordErrors: { substitutions: 4, deletions: 2, insertions: 0, referenceWords: 20, wer: 0.3, deletionRate: 0.1, insertionRate: 0, substitutionRate: 0.2, accuracy: 0.7 },
        charErrors: { substitutions: 6, deletions: 4, insertions: 0, referenceChars: 100, cer: 0.1 },
        detailedCharErrors: { substitutions: 6, deletions: 4, insertions: 0, referenceChars: 100, cer: 0.1 },
        scriptDiagnostics: { devanagariChars: 0, latinChars: 80, persoArabicChars: 0, otherChars: 0, totalLetters: 80, replacementChars: 0, suspiciousMarks: 0, dominantScript: "latin", expectedScriptMatchRate: 1.0, hasCorruptedUnicode: false },
        deletionRate: 0.1,
        maxGapSeconds: 0.2,
        wordsInSilence: 0,
        wallTimeMs: 10000,
        rtf: 0.5,
        stats: dummyStats,
        hypothesisText: "hyp text 2",
        normalizedReference: "ref text 2",
        normalizedHypothesis: "hyp text 2",
      },
      {
        runIndex: 1,
        id: "SAMPLE_1",
        category: "03_hinglish",
        language: "auto",
        scoringProfile: "mixed_diagnostic",
        duration: 10,
        detectedLanguage: "hi",
        referenceVerified: true,
        referenceId: "auto_hinglish_mixed",
        wordErrors: { substitutions: 8, deletions: 1, insertions: 0, referenceWords: 10, wer: 0.9 },
        detailedWordErrors: { substitutions: 8, deletions: 1, insertions: 0, referenceWords: 10, wer: 0.9, deletionRate: 0.1, insertionRate: 0, substitutionRate: 0.8, accuracy: 0.1 },
        charErrors: { substitutions: 30, deletions: 5, insertions: 0, referenceChars: 50, cer: 0.7 },
        detailedCharErrors: { substitutions: 30, deletions: 5, insertions: 0, referenceChars: 50, cer: 0.7 },
        scriptDiagnostics: { devanagariChars: 10, latinChars: 10, persoArabicChars: 0, otherChars: 0, totalLetters: 20, replacementChars: 0, suspiciousMarks: 0, dominantScript: "mixed", expectedScriptMatchRate: 1.0, hasCorruptedUnicode: false },
        deletionRate: 0.1,
        maxGapSeconds: 0.5,
        wordsInSilence: 0,
        wallTimeMs: 5000,
        rtf: 0.5,
        stats: dummyStats,
        hypothesisText: "hyp text auto",
        normalizedReference: "ref text auto",
        normalizedHypothesis: "hyp text auto",
      },
    ];

    it("separates forced hinglish from auto mode in category summaries", () => {
      const summaries = computeCategorySummaries(mockResults);
      expect(summaries.length).toBe(2);

      const hinglishSummary = summaries.find((s) => s.groupKey === "03_hinglish [hinglish]")!;
      expect(hinglishSummary).toBeDefined();
      expect(hinglishSummary.samples).toBe(2);
      expect(hinglishSummary.profile).toBe("hinglish_roman");

      // Micro WER: Total edits (2 + 6 = 8) / Total ref words (10 + 20 = 30) = 8/30 = 0.2667
      expect(hinglishSummary.microWer).toBeCloseTo(8 / 30);
      // Macro WER: Mean(0.2, 0.3) = 0.25
      expect(hinglishSummary.macroWer).toBeCloseTo(0.25);

      const autoSummary = summaries.find((s) => s.groupKey === "03_hinglish [auto]")!;
      expect(autoSummary).toBeDefined();
      expect(autoSummary.samples).toBe(1);
      expect(autoSummary.profile).toBe("mixed_diagnostic");
      expect(autoSummary.macroWer).toBe(0.9);
    });
  });
});
