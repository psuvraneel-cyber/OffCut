import type { ModelSize } from "../types";

export interface ModelConfig {
  id: string;
  supportsWordTimestamps: boolean;
}

export const MODEL_CONFIG: Record<ModelSize, ModelConfig> = {
  tiny: {
    id: "onnx-community/whisper-tiny_timestamped",
    supportsWordTimestamps: true,
  },
  base: {
    id: "onnx-community/whisper-base_timestamped",
    supportsWordTimestamps: true,
  },
  small: {
    id: "onnx-community/whisper-small_timestamped",
    supportsWordTimestamps: true,
  },
};

export function chooseDtype(device: "webgpu" | "wasm", shaderF16: boolean): string {
  if (device === "wasm") {
    return "q8";
  }
  return shaderF16 ? "fp16" : "fp32";
}

// Hindi and Hinglish references need up to 15.2 Whisper tokens per second of audio, English 3–5.
// Twice the highest real rate stops runaway output early; Whisper's decoder holds 448 tokens.
export const GENERATION_CONSTANTS = {
  maxTokensPerSecond: 30,
  minNewTokens: 64,
  maxNewTokens: 440,
} as const;

export function maxNewTokensFor(seconds: number): number {
  const byDuration = Math.ceil(seconds * GENERATION_CONSTANTS.maxTokensPerSecond);
  return Math.min(GENERATION_CONSTANTS.maxNewTokens, Math.max(GENERATION_CONSTANTS.minNewTokens, byDuration));
}

export type ModuleDtypes = string | { encoder_model: string; decoder_model_merged: string };

// The fp16 Whisper encoder produces garbage on WebGPU (measured on base: dashes and
// repetition loops), so "fp16" keeps the encoder in fp32 and only the decoder in fp16.
export function pipelineDtype(dtype: string): ModuleDtypes {
  if (dtype === "fp16") {
    return { encoder_model: "fp32", decoder_model_merged: "fp16" };
  }
  return dtype;
}
