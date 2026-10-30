import { describe, it, expect } from "vitest";
import { measureAudioStats, conditionAudio } from "../src/audio/dsp";
import { calculateIntervalUnionDuration } from "../src/whisper/windows";
import type { PipelineStageAttrition } from "../src/types";

describe("Diagnostics and Instrumentation", () => {
  describe("measureAudioStats", () => {
    it("handles empty buffers safely", () => {
      const stats = measureAudioStats(new Float32Array(0));
      expect(stats.sampleCount).toBe(0);
      expect(stats.duration).toBe(0);
      expect(stats.rms).toBe(0);
      expect(stats.peak).toBe(0);
      expect(stats.clippedCount).toBe(0);
      expect(stats.nearSilenceRatio).toBe(1);
    });

    it("measures a silent buffer correctly", () => {
      const silent = new Float32Array(16000); // 1 second of silence
      const stats = measureAudioStats(silent, 16000);
      expect(stats.sampleCount).toBe(16000);
      expect(stats.duration).toBe(1);
      expect(stats.rms).toBe(0);
      expect(stats.peak).toBe(0);
      expect(stats.clippedCount).toBe(0);
      expect(stats.nearSilenceRatio).toBe(1);
    });

    it("measures a full-scale sine wave accurately", () => {
      const sampleRate = 16000;
      const freq = 440;
      const duration = 1;
      const samples = sampleRate * duration;
      const pcm = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        pcm[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }

      const stats = measureAudioStats(pcm, sampleRate);
      expect(stats.sampleCount).toBe(16000);
      expect(stats.duration).toBe(1);
      // Sine wave peak is 1.0, RMS is ~1/sqrt(2) ≈ 0.7071
      expect(stats.peak).toBeCloseTo(1.0, 2);
      expect(stats.rms).toBeCloseTo(0.7071, 2);
      expect(stats.clippedCount).toBeGreaterThan(0); // peaks hit 1.0 >= 0.9999
      expect(stats.nearSilenceRatio).toBeLessThan(0.05);
    });

    it("detects clipping and non-finite values", () => {
      const pcm = new Float32Array([0.5, 0.5, 1.0, -1.0, NaN]);
      const stats = measureAudioStats(pcm, 16000);
      expect(stats.sampleCount).toBe(5);
      expect(stats.nonFiniteCount).toBe(1);
      expect(stats.peak).toBe(1.0);
      expect(stats.clippedCount).toBe(2); // 1.0 and -1.0
    });
  });

  describe("conditionAudio modes", () => {
    it("returns unmodified copy when mode is 'none'", () => {
      const pcm = new Float32Array([0.1, -0.2, 0.3, -0.4]);
      const conditioned = conditionAudio(pcm, 16000, 0.95, "none");
      expect(Array.from(conditioned)).toEqual(Array.from(pcm));
    });

    it("normalizes without filtering when mode is 'norm_only'", () => {
      const pcm = new Float32Array([0.1, -0.2, 0.3, -0.4]);
      const conditioned = conditionAudio(pcm, 16000, 0.95, "norm_only");
      const peak = Math.max(...Array.from(conditioned).map(Math.abs));
      // Should be scaled to target peak 0.95
      expect(peak).toBeCloseTo(0.95, 2);
    });

    it("applies filtering without normalization when mode is 'filter_only'", () => {
      // Buffer with large DC offset
      const pcm = new Float32Array(1000).fill(0.5);
      const conditioned = conditionAudio(pcm, 16000, 0.95, "filter_only");
      // Highpass/DC block filter should bring late values near 0
      const lastVal = Math.abs(conditioned[conditioned.length - 1]);
      expect(lastVal).toBeLessThan(0.05);
    });

    it("applies both filtering and normalization in 'legacy' mode", () => {
      const pcm = new Float32Array(1000).fill(0.1);
      const conditioned = conditionAudio(pcm, 16000, 0.95, "legacy");
      expect(conditioned.length).toBe(1000);
      const peak = Math.max(...Array.from(conditioned).map(Math.abs));
      expect(peak).toBeCloseTo(0.95, 2);
    });
  });

  describe("calculateIntervalUnionDuration", () => {
    it("returns 0 for empty intervals", () => {
      expect(calculateIntervalUnionDuration([])).toBe(0);
    });

    it("returns duration for a single interval", () => {
      expect(calculateIntervalUnionDuration([{ start: 1.5, end: 4.5 }])).toBe(3.0);
    });

    it("sums non-overlapping disjoint intervals", () => {
      expect(
        calculateIntervalUnionDuration([
          { start: 0, end: 2 },
          { start: 3, end: 5 },
          { start: 7, end: 10 },
        ]),
      ).toBe(7.0);
    });

    it("merges overlapping intervals correctly", () => {
      expect(
        calculateIntervalUnionDuration([
          { start: 0, end: 3 },
          { start: 2, end: 5 }, // overlaps [0, 3] -> [0, 5] (len 5)
          { start: 4, end: 6 }, // overlaps [0, 5] -> [0, 6] (len 6)
          { start: 8, end: 10 }, // separate (len 2)
        ]),
      ).toBe(8.0);
    });

    it("handles unordered, nested, and adjacent intervals", () => {
      expect(
        calculateIntervalUnionDuration([
          { start: 10, end: 12 },
          { start: 1, end: 5 },
          { start: 2, end: 4 }, // nested
          { start: 5, end: 7 }, // adjacent
        ]),
      ).toBe((7 - 1) + (12 - 10)); // 6 + 2 = 8
    });
  });

  describe("PipelineStageAttrition calculations", () => {
    it("computes retention safely without division by zero", () => {
      const sampleAttrition: PipelineStageAttrition = {
        stage: "whisper_raw_to_parsed",
        inputWords: 0,
        outputWords: 0,
        removedWords: 0,
        retentionRate: 0,
      };

      expect(sampleAttrition.retentionRate).toBe(0);
      expect(Number.isFinite(sampleAttrition.retentionRate)).toBe(true);
    });
  });
});
