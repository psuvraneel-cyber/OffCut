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
 * Combined audio conditioning: applies high-pass filter then peak normalization.
 */
export function conditionAudio(
  pcm: Float32Array,
  sampleRate = DSP_CONSTANTS.sampleRate,
  targetPeak = DSP_CONSTANTS.targetPeak,
): Float32Array {
  const filtered = applyHighPassFilter(pcm, sampleRate);
  return normalizePeak(filtered, targetPeak);
}
