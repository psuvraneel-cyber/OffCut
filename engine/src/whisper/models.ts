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
