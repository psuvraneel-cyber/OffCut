import { describe, expect, it } from "vitest";
import {
  calculateRms,
  cleanLanguageCode,
  detectLanguage,
  findBestLanguage,
  parseGeneratedLanguageToken,
  selectDetectionWindowIndex,
} from "../src/whisper/language";

describe("language detection pure helpers", () => {
  it("cleans language tokens to ISO codes", () => {
    expect(cleanLanguageCode("<|en|>")).toBe("en");
    expect(cleanLanguageCode("<|hi|>")).toBe("hi");
    expect(cleanLanguageCode("<|es|>")).toBe("es");
    expect(cleanLanguageCode("en")).toBe("en");
    expect(cleanLanguageCode("HI")).toBe("hi");
  });

  it("calculates RMS correctly", () => {
    expect(calculateRms(new Float32Array())).toBe(0);
    expect(calculateRms(new Float32Array([0, 0, 0]))).toBe(0);

    const constant = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(calculateRms(constant)).toBeCloseTo(0.5, 4);

    const alternating = new Float32Array([1, -1, 1, -1]);
    expect(calculateRms(alternating)).toBeCloseTo(1, 4);
  });

  it("selects the detection window index based on RMS threshold", () => {
    expect(selectDetectionWindowIndex([0.02, 0.005, 0.01])).toBe(0);
    expect(selectDetectionWindowIndex([0.001, 0.015, 0.005])).toBe(1);
    expect(selectDetectionWindowIndex([0.001, 0.002, 0.012])).toBe(2);
    expect(selectDetectionWindowIndex([0.001, 0.002, 0.003, 0.05])).toBe(0);
    expect(selectDetectionWindowIndex([])).toBe(0);
  });

  it("finds the best language from logits restricting to language tokens", () => {
    const langToId = {
      "<|en|>": 10,
      "<|hi|>": 20,
      "<|es|>": 30,
    };

    const logits = new Float32Array(50);
    logits[10] = 2.5; // en
    logits[20] = 8.1; // hi (highest)
    logits[30] = 4.2; // es
    logits[40] = 99.0; // non-language token (should be ignored!)

    expect(findBestLanguage(logits, langToId)).toBe("hi");

    // With offset
    const batchedLogits = new Float32Array(100);
    batchedLogits[50 + 10] = 7.5; // en (highest in second position)
    batchedLogits[50 + 20] = 1.1; // hi
    batchedLogits[50 + 30] = 3.0; // es

    expect(findBestLanguage(batchedLogits, langToId, 50)).toBe("en");
  });

  it("parses generated token output in generate fallback", () => {
    const langToId = {
      "<|en|>": 50259,
      "<|hi|>": 50276,
    };

    const outputSequences = {
      sequences: {
        tolist: () => [[50258, 50276]], // <|startoftranscript|>, <|hi|>
      },
    };
    expect(parseGeneratedLanguageToken(outputSequences, langToId)).toBe("hi");

    const nonLanguageOutput = {
      sequences: {
        tolist: () => [[50258, 1234]],
      },
    };
    expect(parseGeneratedLanguageToken(nonLanguageOutput, langToId)).toBeNull();
  });

  it("detectLanguage uses forward pass when available", async () => {
    const langToId = {
      "<|en|>": 1,
      "<|hi|>": 2,
    };

    const mockPipeline = {
      model: {
        generation_config: {
          decoder_start_token_id: 50258,
          lang_to_id: langToId,
          is_multilingual: true,
        },
        forward: async () => {
          const logitsData = new Float32Array([0, 1.0, 5.0]); // hi has score 5.0
          return {
            logits: {
              dims: [1, 1, 3],
              data: logitsData,
            },
          };
        },
      },
      processor: async () => ({
        input_features: {} as never,
      }),
    };

    const detected = await detectLanguage(mockPipeline, new Float32Array(100));
    expect(detected).toBe("hi");
  });

  it("detectLanguage falls back to generate when forward fails", async () => {
    const langToId = {
      "<|en|>": 50259,
      "<|hi|>": 50276,
    };

    const mockPipeline = {
      model: {
        generation_config: {
          decoder_start_token_id: 50258,
          lang_to_id: langToId,
          is_multilingual: true,
        },
        forward: async () => {
          throw new Error("Forward not supported");
        },
        generate: async () => ({
          sequences: {
            tolist: () => [[50258, 50259]],
          },
        }),
      },
      processor: async () => ({
        input_features: {} as never,
      }),
    };

    const detected = await detectLanguage(mockPipeline, new Float32Array(100));
    expect(detected).toBe("en");
  });

  it("detectLanguage falls back to en on English-only model", async () => {
    const mockPipeline = {
      model: {
        generation_config: {
          is_multilingual: false,
        },
      },
      processor: async () => ({
        input_features: {} as never,
      }),
    };

    const detected = await detectLanguage(mockPipeline, new Float32Array(100));
    expect(detected).toBe("en");
  });
});
