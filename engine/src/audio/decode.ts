import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  type InputAudioTrack,
} from "mediabunny";
import { NoAudioTrackError } from "../errors";
import type { AudioWindow, ConditioningMode } from "../types";
import { conditionAudio } from "./dsp";
import { downmixToMono, resampleMono } from "./resample";

export class NeedsFallbackDecodeError extends Error {
  constructor(message = "This file needs fallback decoding on the main thread.") {
    super(message);
    this.name = "NeedsFallbackDecodeError";
  }
}

export interface AudioWindowProvider {
  readonly duration: number;
  getWindow(
    window: AudioWindow,
    signal: AbortSignal,
    onProgress?: (seconds: number) => void,
    conditioning?: ConditioningMode,
  ): Promise<Float32Array>;
  dispose(): void;
}

export async function openAudioProvider(file: Blob): Promise<AudioWindowProvider> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  try {
    if (!(await input.canRead())) {
      input.dispose();
      throw new NeedsFallbackDecodeError();
    }

    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      input.dispose();
      throw new NoAudioTrackError();
    }

    if (!(await track.canDecode())) {
      input.dispose();
      throw new NeedsFallbackDecodeError();
    }

    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) {
      input.dispose();
      throw new NeedsFallbackDecodeError();
    }

    return new MediabunnyAudioProvider(input, track, duration);
  } catch (error) {
    if (error instanceof NoAudioTrackError || error instanceof NeedsFallbackDecodeError) {
      throw error;
    }

    input.dispose();
    throw new NeedsFallbackDecodeError();
  }
}

class MediabunnyAudioProvider implements AudioWindowProvider {
  readonly #sink: AudioSampleSink;
  readonly #sampleRate: number;
  readonly #input: Input;
  readonly duration: number;

  constructor(
    input: Input,
    track: InputAudioTrack,
    duration: number,
  ) {
    this.#input = input;
    this.#sink = new AudioSampleSink(track);
    this.#sampleRate = track.sampleRate;
    this.duration = duration;
  }

  async getWindow(
    window: AudioWindow,
    signal: AbortSignal,
    onProgress?: (seconds: number) => void,
    conditioning: ConditioningMode = "legacy",
  ): Promise<Float32Array> {
    throwIfAborted(signal);
    const sourceLength = Math.max(1, Math.ceil((window.end - window.start) * this.#sampleRate) + 2);
    const source = new Float32Array(sourceLength);
    let lastProgressAt = performance.now();

    for await (const sample of this.#sink.samples(window.start, window.end)) {
      throwIfAborted(signal);
      const sourceStart = Math.max(window.start, sample.timestamp);
      const sourceEnd = Math.min(window.end, sample.timestamp + sample.duration);
      if (sourceEnd <= sourceStart) {
        continue;
      }

      try {
        const sampleStartFrame = Math.max(0, Math.floor((sourceStart - sample.timestamp) * sample.sampleRate));
        const sampleEndFrame = Math.min(
          sample.numberOfFrames,
          Math.ceil((sourceEnd - sample.timestamp) * sample.sampleRate),
        );
        if (sampleEndFrame <= sampleStartFrame) {
          continue;
        }

        const frameCount = sampleEndFrame - sampleStartFrame;
        const channels = Array.from({ length: sample.numberOfChannels }, (_, channelIndex) => {
          const channel = new Float32Array(frameCount);
          sample.copyTo(channel, {
            planeIndex: channelIndex,
            format: "f32-planar",
            frameOffset: sampleStartFrame,
            frameCount,
          });
          return channel;
        });
        const mono = downmixToMono(channels);
        const writeOffset = Math.max(0, Math.round((sourceStart - window.start) * this.#sampleRate));
        source.set(mono.subarray(0, Math.max(0, source.length - writeOffset)), writeOffset);

        if (onProgress && performance.now() - lastProgressAt >= 250) {
          onProgress(Math.min(window.end, sourceEnd));
          lastProgressAt = performance.now();
        }
      } finally {
        sample.close();
      }
    }

    onProgress?.(window.end);
    return conditionAudio(resampleMono(source, this.#sampleRate), undefined, undefined, conditioning);
  }

  dispose(): void {
    this.#input.dispose();
  }
}

export class PcmAudioWindowProvider implements AudioWindowProvider {
  readonly #pcm: Float32Array;
  readonly #sampleRate: number;
  readonly duration: number;

  constructor(pcm: Float32Array, sampleRate = 16_000, duration?: number) {
    this.#pcm = pcm;
    this.#sampleRate = sampleRate;
    this.duration = duration ?? (sampleRate > 0 ? pcm.length / sampleRate : 0);
  }

  async getWindow(
    window: AudioWindow,
    signal: AbortSignal,
    onProgress?: (seconds: number) => void,
    conditioning: ConditioningMode = "legacy",
  ): Promise<Float32Array> {
    throwIfAborted(signal);
    const startSample = Math.max(0, Math.floor(window.start * this.#sampleRate));
    const endSample = Math.min(this.#pcm.length, Math.ceil(window.end * this.#sampleRate));
    if (endSample <= startSample) {
      return new Float32Array();
    }
    const slice = this.#pcm.subarray(startSample, endSample).slice();
    const resampled = this.#sampleRate === 16_000 ? slice : resampleMono(slice, this.#sampleRate);
    onProgress?.(window.end);
    return conditionAudio(resampled, undefined, undefined, conditioning);
  }

  dispose(): void {
    // PCM buffer can be reclaimed when provider reference drops
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Transcription was cancelled.", "AbortError");
  }
}
