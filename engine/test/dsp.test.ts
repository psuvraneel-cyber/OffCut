import { describe, expect, it } from "vitest";
import {
  applyHighPassFilter,
  normalizePeak,
  conditionAudio,
  DSP_CONSTANTS,
} from "../src/audio/dsp";

describe("Audio DSP Module", () => {
  it("handles empty arrays gracefully", () => {
    expect(applyHighPassFilter(new Float32Array(0))).toEqual(new Float32Array(0));
    expect(normalizePeak(new Float32Array(0))).toEqual(new Float32Array(0));
    expect(conditionAudio(new Float32Array(0))).toEqual(new Float32Array(0));
  });

  it("removes DC offset (0 Hz)", () => {
    // Constant signal of 1.0 (DC)
    const length = 16000; // 1 second of DC
    const dcSignal = new Float32Array(length).fill(1.0);
    const filtered = applyHighPassFilter(dcSignal);

    // After initial filter transient (e.g. 500 samples), the signal should decay to ~0
    let steadyStateMax = 0;
    for (let i = 1000; i < length; i++) {
      const val = Math.abs(filtered[i]);
      if (val > steadyStateMax) steadyStateMax = val;
    }
    expect(steadyStateMax).toBeLessThan(0.001);
  });

  it("strongly attenuates 30 Hz sub-bass while preserving 1000 Hz speech formants", () => {
    const sampleRate = 16000;
    const duration = 0.5; // 0.5s
    const length = Math.floor(sampleRate * duration);

    // 30 Hz sine wave (sub-bass / kick rumble)
    const subBass = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      subBass[i] = Math.sin((2 * Math.PI * 30 * i) / sampleRate);
    }

    // 1000 Hz sine wave (human speech formant)
    const speechFormant = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      speechFormant[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
    }

    const filteredSubBass = applyHighPassFilter(subBass, sampleRate, 80);
    const filteredSpeech = applyHighPassFilter(speechFormant, sampleRate, 80);

    // Compute RMS after transient (samples 500 to end)
    function computeRms(arr: Float32Array): number {
      let sum = 0;
      let count = 0;
      for (let i = 500; i < arr.length; i++) {
        sum += arr[i] * arr[i];
        count++;
      }
      return Math.sqrt(sum / count);
    }

    const inputRms = 1 / Math.SQRT2; // ~0.707
    const subBassRms = computeRms(filteredSubBass);
    const speechRms = computeRms(filteredSpeech);

    // 30 Hz is well below 80 Hz cutoff: should be attenuated by > 14 dB (gain < 0.20)
    expect(subBassRms / inputRms).toBeLessThan(0.20);

    // 1000 Hz is well inside passband: should be virtually unattenuated (> 0.98 gain)
    expect(speechRms / inputRms).toBeGreaterThan(0.98);
  });

  it("normalizes peak amplitude of quiet audio to target peak", () => {
    const quiet = new Float32Array([0.05, -0.2, 0.15, -0.1]);
    const normalized = normalizePeak(quiet, 0.95);

    let maxAmp = 0;
    for (let i = 0; i < normalized.length; i++) {
      const abs = Math.abs(normalized[i]);
      if (abs > maxAmp) maxAmp = abs;
    }

    expect(maxAmp).toBeCloseTo(0.95, 4);
    // Relative ratios preserved
    expect(normalized[1]).toBeCloseTo(-0.95, 4);
    expect(normalized[0]).toBeCloseTo(0.05 * (0.95 / 0.2), 4);
  });

  it("does not amplify pure silence or near-zero noise floor below threshold", () => {
    const silence = new Float32Array([0.0001, -0.0002, 0.00005]);
    const normalized = normalizePeak(silence, 0.95, DSP_CONSTANTS.minPeakForNormalization);
    expect(normalized).toBe(silence);
  });

  it("conditionAudio applies high-pass filtering and normalizes to target peak", () => {
    const sampleRate = 16000;
    const length = 2000;
    const signal = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      signal[i] = 0.3 * Math.sin((2 * Math.PI * 400 * i) / sampleRate);
    }

    const conditioned = conditionAudio(signal, sampleRate, 0.95);
    let maxAmp = 0;
    for (let i = 0; i < conditioned.length; i++) {
      const abs = Math.abs(conditioned[i]);
      if (abs > maxAmp) maxAmp = abs;
    }
    expect(maxAmp).toBeCloseTo(0.95, 4);
  });
});
