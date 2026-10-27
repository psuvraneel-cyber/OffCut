import { describe, expect, it } from "vitest";
import { probabilitiesToSegments, VAD_CONSTANTS } from "../src/whisper/vad";

describe("Silero VAD probabilitiesToSegments", () => {
  const frameSec = VAD_CONSTANTS.frameSize / VAD_CONSTANTS.sampleRate; // 0.032s = 32ms

  it("returns empty array when all probabilities are below threshold", () => {
    const probs = new Float32Array(100);
    const segments = probabilitiesToSegments(probs, {}, 3.2);
    expect(segments).toEqual([]);
  });

  it("ignores brief speech bursts shorter than minSpeechMs (250ms)", () => {
    const probs = new Float32Array(100);
    // 4 frames = 128ms < 250ms
    probs.fill(0.95, 20, 24);
    const segments = probabilitiesToSegments(probs, {}, 3.2);
    expect(segments).toEqual([]);
  });

  it("detects valid speech segment with padding", () => {
    const probs = new Float32Array(100);
    // 20 frames = 640ms >= minSpeechMs
    probs.fill(0.9, 20, 40);
    const segments = probabilitiesToSegments(probs, {}, 3.2);
    expect(segments).toHaveLength(1);

    const padSec = VAD_CONSTANTS.speechPadMs / 1000;
    expect(segments[0].start).toBeCloseTo(Math.max(0, 20 * frameSec - padSec), 2);
    expect(segments[0].end).toBeCloseTo(40 * frameSec + padSec, 2);
  });

  it("bridges silence gaps shorter than minSilenceMs (300ms)", () => {
    const probs = new Float32Array(100);
    probs.fill(0.9, 10, 25);
    // 4 frames of silence = 128ms < 300ms
    probs.fill(0.1, 25, 29);
    probs.fill(0.9, 29, 45);

    const segments = probabilitiesToSegments(probs, {}, 3.2);
    expect(segments).toHaveLength(1);
    const padSec = VAD_CONSTANTS.speechPadMs / 1000;
    expect(segments[0].start).toBeCloseTo(Math.max(0, 10 * frameSec - padSec), 2);
    expect(segments[0].end).toBeCloseTo(45 * frameSec + padSec, 2);
  });

  it("splits segments when silence gap exceeds minSilenceMs", () => {
    const probs = new Float32Array(100);
    probs.fill(0.9, 10, 25);
    // 15 frames of silence = 480ms > 300ms
    probs.fill(0.1, 25, 40);
    probs.fill(0.9, 40, 55);

    const segments = probabilitiesToSegments(probs, {}, 3.2);
    expect(segments).toHaveLength(2);
    expect(segments[0].end).toBeLessThan(segments[1].start);
  });

  it("clamps padded segments to [0, duration]", () => {
    const probs = new Float32Array(50);
    // Speech right at the beginning and right at the end
    probs.fill(0.9, 0, 15);
    probs.fill(0.9, 35, 50);

    const duration = 50 * frameSec;
    const segments = probabilitiesToSegments(probs, {}, duration);
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].end).toBe(duration);
  });
});
