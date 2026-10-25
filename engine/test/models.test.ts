import { describe, expect, it } from "vitest";
import { chooseDtype, pipelineDtype } from "../src/whisper/models";

describe("Model precision", () => {
  it("keeps the encoder in fp32 when fp16 is chosen", () => {
    expect(pipelineDtype("fp16")).toEqual({ encoder_model: "fp32", decoder_model_merged: "fp16" });
  });

  it("passes other precisions through unchanged", () => {
    expect(pipelineDtype("fp32")).toBe("fp32");
    expect(pipelineDtype("q8")).toBe("q8");
  });

  it("still picks fp16 on WebGPU with shader-f16 and q8 on WASM", () => {
    expect(chooseDtype("webgpu", true)).toBe("fp16");
    expect(chooseDtype("webgpu", false)).toBe("fp32");
    expect(chooseDtype("wasm", true)).toBe("q8");
  });
});
