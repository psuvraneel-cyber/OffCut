import { describe, expect, it } from "vitest";
import { chooseDtype, maxNewTokensFor, pipelineDtype } from "../src/whisper/models";

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

describe("Output length cap", () => {
  it("allows 30 tokens per second with a floor of 64", () => {
    expect(maxNewTokensFor(5.344)).toBe(161);
    expect(maxNewTokensFor(1)).toBe(64);
  });

  it("never exceeds Whisper's decoder limit", () => {
    expect(maxNewTokensFor(28)).toBe(440);
    expect(maxNewTokensFor(30)).toBe(440);
  });

  it("leaves room for the densest real speech in the test set (15.2 tokens/s)", () => {
    for (const seconds of [1, 4.5, 10, 14]) {
      expect(maxNewTokensFor(seconds)).toBeGreaterThanOrEqual(Math.ceil(seconds * 15.2));
    }
  });
});
