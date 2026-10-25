import { describe, expect, it } from "vitest";
import { downmixToMono, resampleMono } from "../src/audio/resample";

function calculateRms(samples: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

describe("audio resampling", () => {
  it("downmixes stereo and preserves one second at 16 kHz", () => {
    const sourceRate = 48_000;
    const duration = 1;
    const frequency = 440;
    const left = new Float32Array(sourceRate * duration);
    const right = new Float32Array(sourceRate * duration);
    for (let index = 0; index < left.length; index += 1) {
      const sample = Math.sin((2 * Math.PI * frequency * index) / sourceRate);
      left[index] = sample;
      right[index] = sample * 0.8;
    }

    const mono = downmixToMono([left, right]);
    const output = resampleMono(mono, sourceRate, 16_000);
    expect(output.length).toBe(16_000);
    expect(Math.abs(output.length / 16_000 - duration)).toBeLessThanOrEqual(1 / 16_000);

    let positiveCrossings = 0;
    for (let index = 1; index < output.length; index += 1) {
      if (output[index - 1] <= 0 && output[index] > 0) {
        positiveCrossings += 1;
      }
    }
    const estimatedFrequency = positiveCrossings / duration;
    expect(Math.abs(estimatedFrequency - frequency)).toBeLessThanOrEqual(2);
  });

  it("filters out a 12 kHz sine at 48 kHz so output RMS is below 5% of input RMS", () => {
    const sourceRate = 48_000;
    const targetRate = 16_000;
    const frequency = 12_000;
    const duration = 0.5;
    const length = Math.round(sourceRate * duration);
    const input = new Float32Array(length);

    for (let index = 0; index < length; index += 1) {
      input[index] = Math.sin((2 * Math.PI * frequency * index) / sourceRate);
    }

    const inputRms = calculateRms(input);
    const output = resampleMono(input, sourceRate, targetRate);
    const outputRms = calculateRms(output);

    expect(outputRms / inputRms).toBeLessThan(0.05);
  });

  it("preserves a 440 Hz sine at 48 kHz within 5% of input RMS", () => {
    const sourceRate = 48_000;
    const targetRate = 16_000;
    const frequency = 440;
    const duration = 0.5;
    const length = Math.round(sourceRate * duration);
    const input = new Float32Array(length);

    for (let index = 0; index < length; index += 1) {
      input[index] = Math.sin((2 * Math.PI * frequency * index) / sourceRate);
    }

    const inputRms = calculateRms(input);
    const output = resampleMono(input, sourceRate, targetRate);
    const outputRms = calculateRms(output);

    expect(Math.abs(outputRms - inputRms) / inputRms).toBeLessThan(0.05);
  });
});
