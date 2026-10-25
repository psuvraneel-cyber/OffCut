export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array();
  }

  const length = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  const mono = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    let count = 0;
    for (const channel of channels) {
      if (index < channel.length) {
        sum += channel[index];
        count += 1;
      }
    }
    mono[index] = count > 0 ? sum / count : 0;
  }

  return mono;
}

export function createBlackmanSincFilter(
  sourceRate: number,
  cutoff: number,
  taps = 65,
): Float32Array {
  if (taps % 2 === 0) {
    taps += 1;
  }
  const mid = Math.floor(taps / 2);
  const kernel = new Float32Array(taps);
  const normalizedCutoff = cutoff / sourceRate;

  let sum = 0;
  for (let index = 0; index < taps; index += 1) {
    const offset = index - mid;
    const sinc =
      offset === 0
        ? 2 * normalizedCutoff
        : Math.sin(2 * Math.PI * normalizedCutoff * offset) / (Math.PI * offset);
    const blackman =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * index) / (taps - 1)) +
      0.08 * Math.cos((4 * Math.PI * index) / (taps - 1));
    const value = sinc * blackman;
    kernel[index] = value;
    sum += value;
  }

  if (sum !== 0) {
    for (let index = 0; index < taps; index += 1) {
      kernel[index] /= sum;
    }
  }

  return kernel;
}

export function applyLowPassFir(input: Float32Array, kernel: Float32Array): Float32Array {
  const taps = kernel.length;
  const mid = Math.floor(taps / 2);
  const padded = new Float32Array(input.length + taps - 1);
  padded.set(input, mid);
  const output = new Float32Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    let acc0 = 0;
    let acc1 = 0;
    let acc2 = 0;
    let acc3 = 0;
    let tapIndex = 0;

    for (; tapIndex <= taps - 4; tapIndex += 4) {
      acc0 += padded[index + tapIndex] * kernel[tapIndex];
      acc1 += padded[index + tapIndex + 1] * kernel[tapIndex + 1];
      acc2 += padded[index + tapIndex + 2] * kernel[tapIndex + 2];
      acc3 += padded[index + tapIndex + 3] * kernel[tapIndex + 3];
    }

    let acc = acc0 + acc1 + acc2 + acc3;
    for (; tapIndex < taps; tapIndex += 1) {
      acc += padded[index + tapIndex] * kernel[tapIndex];
    }
    output[index] = acc;
  }

  return output;
}

export function resampleMono(input: Float32Array, sourceRate: number, targetRate = 16_000): Float32Array {
  if (input.length === 0) {
    return new Float32Array();
  }

  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new RangeError("Sample rates must be positive finite numbers.");
  }

  if (sourceRate === targetRate) {
    return input.slice();
  }

  let source = input;
  if (sourceRate > targetRate) {
    const kernel = createBlackmanSincFilter(sourceRate, 0.45 * targetRate, 65);
    source = applyLowPassFir(input, kernel);
  }

  const outputLength = Math.max(1, Math.round((source.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, source.length - 1);
    const fraction = position - left;
    output[index] = source[left] * (1 - fraction) + source[right] * fraction;
  }

  return output;
}
