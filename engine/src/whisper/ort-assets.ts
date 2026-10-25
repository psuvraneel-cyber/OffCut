// ONNX Runtime's default build ("onnxruntime-web" -> dist/ort.bundle.min.mjs) embeds its JavaScript glue,
// so the only file it fetches is the .wasm binary. Transformers.js points that at jsDelivr unless wasmPaths
// is set (@huggingface/transformers src/backends/onnx.js, lines 205–212); this serves our own copy instead.
// onnxruntime-web doesn't export dist/, hence the relative path. test/ort-assets.test.ts guards it.
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";

export function ortWasmPaths(baseUrl: string): { wasm: string } {
  return { wasm: new URL(ortWasmUrl, baseUrl).href };
}
