import type { CapabilityReport, ModelSize } from "./types";

interface GpuAdapter {
  features: Set<string>;
}

interface GpuApi {
  requestAdapter(): Promise<GpuAdapter | null>;
}

export async function detectCapabilities(): Promise<CapabilityReport> {
  const gpu = getGpuApi();
  let webgpu = false;
  let shaderF16 = false;

  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      webgpu = adapter !== null;
      shaderF16 = adapter?.features.has("shader-f16") ?? false;
    } catch {
      webgpu = false;
      shaderF16 = false;
    }
  }

  const recommendedDevice: "webgpu" | "wasm" = webgpu ? "webgpu" : "wasm";
  // base on WASM (q8, 77 MB) matched its WebGPU accuracy; tiny on WASM (q8) fell into repetition loops.
  const recommendedModel: ModelSize = "base";

  return {
    webgpu,
    shaderF16,
    webcodecsAudio: typeof AudioDecoder !== "undefined" && typeof AudioData !== "undefined",
    recommendedModel,
    recommendedDevice,
  };
}

function getGpuApi(): GpuApi | null {
  const candidate = (globalThis as { navigator?: { gpu?: GpuApi } }).navigator?.gpu;
  return candidate ?? null;
}
