import type { AudioStats, ConditioningMode } from "../types";

export const DSP_CONSTANTS = {
  highPassCutoffHz: 80,
  sampleRate: 16000,
  targetPeak: 0.95,
  minPeakForNormalization: 0.001,
} as const;

/**
 * 2nd-order Butterworth High-Pass Filter (Direct Form II Transposed).
 * Removes sub-bass, 808s, HVAC rumble, and DC offset below cutoffHz (default 80 Hz).
 */
export function applyHighPassFilter(
  pcm: Float32Array,
  sampleRate = DSP_CONSTANTS.sampleRate,
  cutoffHz = DSP_CONSTANTS.highPassCutoffHz,
): Float32Array {
  if (pcm.length === 0 || cutoffHz <= 0 || sampleRate <= 0 || cutoffHz >= sampleRate / 2) {
    return pcm;
  }

  // Robert Bristow-Johnson Audio EQ Cookbook biquad high-pass
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 * Math.SQRT1_2; // Q = 1/sqrt(2) approx 0.7071

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  // Normalized coefficients
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  const output = new Float32Array(pcm.length);
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
    const y = nb0 * x + s1;
    s1 = nb1 * x - na1 * y + s2;
    s2 = nb2 * x - na2 * y;
    output[i] = y;
  }

  return output;
}

/**
 * Peak amplitude normalization to targetPeak (default 0.95).
 * Brings low-volume speech up to Whisper's optimal attention range without clipping.
 */
export function normalizePeak(
  pcm: Float32Array,
  targetPeak = DSP_CONSTANTS.targetPeak,
  minPeak = DSP_CONSTANTS.minPeakForNormalization,
): Float32Array {
  if (pcm.length === 0) {
    return pcm;
  }

  let maxAmp = 0;
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i]);
    if (abs > maxAmp) {
      maxAmp = abs;
    }
  }

  if (maxAmp < minPeak) {
    return pcm; // Pure silence or sub-audible noise, do not amplify noise floor
  }

  const gain = targetPeak / maxAmp;
  const output = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    output[i] = pcm[i] * gain;
  }

  return output;
}

/**
 * Combined audio conditioning: applies high-pass filter then peak normalization,
 * or allows isolated ablation configurations ("none", "filter_only", "norm_only").
 */
export function conditionAudio(
  pcm: Float32Array,
  sampleRate = DSP_CONSTANTS.sampleRate,
  targetPeak = DSP_CONSTANTS.targetPeak,
  mode: ConditioningMode = "legacy",
): Float32Array {
  if (mode === "none") {
    return pcm;
  }
  if (mode === "filter_only") {
    return applyHighPassFilter(pcm, sampleRate);
  }
  if (mode === "norm_only") {
    return normalizePeak(pcm, targetPeak);
  }
  const filtered = applyHighPassFilter(pcm, sampleRate);
  return normalizePeak(filtered, targetPeak);
}

/**
 * Calculates compact audio statistics without allocating or retaining raw PCM data.
 */
export function measureAudioStats(
  pcm: Float32Array,
  sampleRate = DSP_CONSTANTS.sampleRate,
): AudioStats {
  if (pcm.length === 0) {
    return {
      sampleCount: 0,
      sampleRate,
      duration: 0,
      rms: 0,
      peak: 0,
      min: 0,
      max: 0,
      nonFiniteCount: 0,
      clippedCount: 0,
      nearSilenceRatio: 1.0,
    };
  }

  let sumSquares = 0;
  let peak = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;
  let nonFiniteCount = 0;
  let clippedCount = 0;
  let nearSilenceCount = 0;

  for (let i = 0; i < pcm.length; i++) {
    const val = pcm[i];
    if (!Number.isFinite(val)) {
      nonFiniteCount++;
      continue;
    }
    const abs = Math.abs(val);
    sumSquares += val * val;
    if (abs > peak) peak = abs;
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
    if (abs >= 0.9999) clippedCount++;
    if (abs < 0.001) nearSilenceCount++;
  }

  const validCount = pcm.length - nonFiniteCount;
  const rms = validCount > 0 ? Math.sqrt(sumSquares / validCount) : 0;
  return {
    sampleCount: pcm.length,
    sampleRate,
    duration: pcm.length / sampleRate,
    rms,
    peak,
    min: minVal === Infinity ? 0 : minVal,
    max: maxVal === -Infinity ? 0 : maxVal,
    nonFiniteCount,
    clippedCount,
    nearSilenceRatio: pcm.length > 0 ? nearSilenceCount / pcm.length : 0,
  };
}
