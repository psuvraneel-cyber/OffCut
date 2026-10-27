import { AutoModel, Tensor } from "@huggingface/transformers";

export const VAD_CONSTANTS = {
  modelId: "onnx-community/silero-vad",
  frameSize: 512,
  sampleRate: 16000,
  contextSize: 64,
  threshold: 0.35,
  negThreshold: 0.25,
  minSpeechMs: 200,
  minSilenceMs: 300,
  speechPadMs: 200,
  maxWindowSeconds: 28,
  forcedOverlapSeconds: 2,
} as const;

export interface SpeechSegment {
  start: number;
  end: number;
}

export function probabilitiesToSegments(
  probs: Float32Array | readonly number[],
  constants: Partial<typeof VAD_CONSTANTS> = {},
  duration?: number,
): SpeechSegment[] {
  const frameSize = constants.frameSize ?? VAD_CONSTANTS.frameSize;
  const sampleRate = constants.sampleRate ?? VAD_CONSTANTS.sampleRate;
  const frameSec = frameSize / sampleRate;
  const threshold = constants.threshold ?? VAD_CONSTANTS.threshold;
  const negThreshold = constants.negThreshold ?? VAD_CONSTANTS.negThreshold;
  const minSpeechMs = constants.minSpeechMs ?? VAD_CONSTANTS.minSpeechMs;
  const minSilenceMs = constants.minSilenceMs ?? VAD_CONSTANTS.minSilenceMs;
  const speechPadMs = constants.speechPadMs ?? VAD_CONSTANTS.speechPadMs;

  const minSpeechFrames = Math.round((minSpeechMs / 1000) / frameSec);
  const minSilenceFrames = Math.round((minSilenceMs / 1000) / frameSec);
  const padSec = speechPadMs / 1000;

  const rawSegments: SpeechSegment[] = [];
  let triggered = false;
  let speechStartFrame = 0;
  let silenceStartFrame = -1;

  for (let i = 0; i < probs.length; i++) {
    const prob = probs[i];

    if (!triggered) {
      if (prob >= threshold) {
        triggered = true;
        speechStartFrame = i;
        silenceStartFrame = -1;
      }
    } else {
      if (prob < negThreshold) {
        if (silenceStartFrame === -1) {
          silenceStartFrame = i;
        }
        if (i - silenceStartFrame >= minSilenceFrames) {
          const speechEndFrame = silenceStartFrame;
          if (speechEndFrame - speechStartFrame >= minSpeechFrames) {
            const startSec = Math.max(0, speechStartFrame * frameSec - padSec);
            const endSec = duration !== undefined
              ? Math.min(duration, speechEndFrame * frameSec + padSec)
              : speechEndFrame * frameSec + padSec;
            rawSegments.push({ start: startSec, end: endSec });
          }
          triggered = false;
          silenceStartFrame = -1;
        }
      } else {
        silenceStartFrame = -1;
      }
    }
  }

  if (triggered) {
    const speechEndFrame = silenceStartFrame !== -1 ? silenceStartFrame : probs.length;
    if (speechEndFrame - speechStartFrame >= minSpeechFrames) {
      const startSec = Math.max(0, speechStartFrame * frameSec - padSec);
      const endSec = duration !== undefined
        ? Math.min(duration, speechEndFrame * frameSec + padSec)
        : speechEndFrame * frameSec + padSec;
      rawSegments.push({ start: startSec, end: endSec });
    }
  }

  if (rawSegments.length <= 1) {
    return rawSegments;
  }

  // Merge overlapping segments produced by padding
  const merged: SpeechSegment[] = [rawSegments[0]];
  for (let i = 1; i < rawSegments.length; i++) {
    const current = rawSegments[i];
    const prev = merged[merged.length - 1];
    if (current.start <= prev.end) {
      prev.end = Math.max(prev.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

export class SileroVadRunner {
  #session: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>> } | null = null;
  #model: { dispose: () => Promise<unknown> } | null = null;
  #state = new Float32Array(2 * 1 * 128);
  #context = new Float32Array(VAD_CONSTANTS.contextSize);
  #srTensor = new Tensor("int64", new BigInt64Array([BigInt(VAD_CONSTANTS.sampleRate)]), [1]);
  #leftover = new Float32Array(0);

  async load(): Promise<void> {
    if (this.#session) return;
    const model = (await AutoModel.from_pretrained(VAD_CONSTANTS.modelId, {
      config: { model_type: "custom" } as never,
      device: "wasm",
      dtype: "fp32",
    })) as unknown as {
      sessions: { model: { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>> } };
      dispose: () => Promise<unknown>;
    };

    this.#model = model;
    this.#session = model.sessions.model;
  }

  async processChunk(pcm16k: Float32Array, isLast = false): Promise<Float32Array> {
    if (!this.#session) throw new Error("Silero VAD session not initialized.");

    let audio = pcm16k;
    if (this.#leftover.length > 0) {
      const combined = new Float32Array(this.#leftover.length + pcm16k.length);
      combined.set(this.#leftover, 0);
      combined.set(pcm16k, this.#leftover.length);
      audio = combined;
      this.#leftover = new Float32Array(0);
    }

    const frameSize = VAD_CONSTANTS.frameSize;
    const numFrames = Math.floor(audio.length / frameSize);
    const extraLastFrame = isLast && audio.length % frameSize > 0 ? 1 : 0;
    const probs = new Float32Array(numFrames + extraLastFrame);

    const inputBuffer = new Float32Array(VAD_CONSTANTS.contextSize + frameSize);
    let outIdx = 0;

    for (let f = 0; f < numFrames; f++) {
      const frameStart = f * frameSize;
      const frameEnd = frameStart + frameSize;
      const frame = audio.subarray(frameStart, frameEnd);

      inputBuffer.set(this.#context, 0);
      inputBuffer.set(frame, VAD_CONSTANTS.contextSize);

      const inputTensor = new Tensor("float32", inputBuffer, [1, inputBuffer.length]);
      const stateTensor = new Tensor("float32", this.#state, [2, 1, 128]);

      const outputs = await this.#session.run({
        input: inputTensor,
        state: stateTensor,
        sr: this.#srTensor,
      });

      probs[outIdx++] = outputs.output.data[0];
      this.#state = new Float32Array(outputs.stateN.data);
      this.#context.set(frame.subarray(frameSize - VAD_CONSTANTS.contextSize), 0);
    }

    const processedSamples = numFrames * frameSize;
    const remaining = audio.subarray(processedSamples);

    if (isLast && remaining.length > 0) {
      const lastFrame = new Float32Array(frameSize);
      lastFrame.set(remaining, 0);

      inputBuffer.set(this.#context, 0);
      inputBuffer.set(lastFrame, VAD_CONSTANTS.contextSize);

      const inputTensor = new Tensor("float32", inputBuffer, [1, inputBuffer.length]);
      const stateTensor = new Tensor("float32", this.#state, [2, 1, 128]);

      const outputs = await this.#session.run({
        input: inputTensor,
        state: stateTensor,
        sr: this.#srTensor,
      });

      probs[outIdx++] = outputs.output.data[0];
    } else if (remaining.length > 0) {
      this.#leftover = new Float32Array(remaining);
    }

    return probs.subarray(0, outIdx);
  }

  reset(): void {
    this.#state.fill(0);
    this.#context.fill(0);
    this.#leftover = new Float32Array(0);
  }

  // Releases the ONNX session. ORT clears its shared WebGPU buffer cache only when no session is left.
  async dispose(): Promise<void> {
    const model = this.#model;
    this.#model = null;
    this.#session = null;
    this.reset();
    await model?.dispose();
  }
}
