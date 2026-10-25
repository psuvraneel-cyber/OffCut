import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ortWasmPaths } from "../src/whisper/ort-assets";

const engineRoot = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(engineRoot + path, "utf8")) as Record<string, unknown>;

describe("Self-hosted ONNX Runtime WASM", () => {
  it("resolves to an absolute same-origin URL, never a CDN", () => {
    const { wasm } = ortWasmPaths("http://127.0.0.1:5180/assets/worker.js");
    const url = new URL(wasm);
    expect(url.origin).toBe("http://127.0.0.1:5180");
    expect(url.pathname.endsWith(".wasm")).toBe(true);
    expect(wasm).not.toContain("jsdelivr");
  });

  it("points at a file that exists in the installed onnxruntime-web", () => {
    expect(existsSync(engineRoot + "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm")).toBe(true);
  });

  it("uses the onnxruntime-web version Transformers.js pins", () => {
    const transformers = readJson("node_modules/@huggingface/transformers/package.json") as {
      dependencies: Record<string, string>;
    };
    const ort = readJson("node_modules/onnxruntime-web/package.json") as { version: string };
    expect(ort.version).toBe(transformers.dependencies["onnxruntime-web"]);
  });
});
