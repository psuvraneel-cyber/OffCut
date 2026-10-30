// @ts-expect-error onnxruntime-web package types resolution
import * as ort from "onnxruntime-web";

const logEl = document.getElementById("log")!;
const statusEl = document.getElementById("status")!;

function log(msg: string, cls = "") {
  console.log(msg);
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = msg + "\n";
  logEl.appendChild(span);
}

// Point wasm assets to Vite-served node_modules path
ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
ort.env.wasm.numThreads = 1; // OffCut single-threaded WASM constraint

async function runTests() {
  const testsRecord: Record<string, unknown> = {};
  const testResults: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    tests: testsRecord,
  };

  log("==================================================================");
  log("Browser-Based Runtime Feasibility Test: IndicConformer 120M");
  log("==================================================================");

  // 1. WASM Test
  log("\n--- TEST 1: ONNX Runtime Web (WASM) ---");
  try {
    const t0 = performance.now();
    statusEl.textContent = "Loading model via WASM ...";
    log("Creating InferenceSession with EP: ['wasm'] ...");
    const wasmSession = await ort.InferenceSession.create("/eval/p2-model-poc/model.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    const wasmLoadMs = performance.now() - t0;
    log(`[PASS] WASM Session created in ${wasmLoadMs.toFixed(1)} ms`, "pass");
    log(`  Inputs: ${JSON.stringify(wasmSession.inputNames)}`);
    log(`  Outputs: ${JSON.stringify(wasmSession.outputNames)}`);

    // Run inference with dummy mel tensor: [1, 80, 200]
    const T = 200;
    const dummySignal = new Float32Array(1 * 80 * T);
    for (let i = 0; i < dummySignal.length; i++) dummySignal[i] = (Math.random() - 0.5) * 2;
    const tensorSignal = new ort.Tensor("float32", dummySignal, [1, 80, T]);
    const tensorLen = new ort.Tensor("int64", new BigInt64Array([BigInt(T)]), [1]);

    const tInf0 = performance.now();
    const wasmOut = await wasmSession.run({
      audio_signal: tensorSignal,
      length: tensorLen,
    });
    const wasmInfMs = performance.now() - tInf0;
    const logprobs = wasmOut.logprobs;
    log(`[PASS] WASM Inference succeeded in ${wasmInfMs.toFixed(1)} ms`, "pass");
    log(`  Output dims: ${JSON.stringify(logprobs.dims)} (subsampling 4x: ${T} -> ${logprobs.dims[1]})`);

    testsRecord["wasm"] = {
      status: "PASS",
      load_ms: wasmLoadMs,
      inference_ms: wasmInfMs,
      output_dims: logprobs.dims,
      threads: 1,
    };
  } catch (err) {
    log(`[FAIL] WASM Test failed: ${err instanceof Error ? err.message : String(err)}`, "fail");
    testsRecord["wasm"] = {
      status: "FAIL",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. WebGPU Test
  log("\n--- TEST 2: ONNX Runtime Web (WebGPU) ---");
  const navGpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!navGpu) {
    log("[WARN] WebGPU not supported on this browser context", "warn");
    testsRecord["webgpu"] = { status: "UNSUPPORTED", reason: "navigator.gpu is null" };
  } else {
    try {
      const adapter = await navGpu.requestAdapter();
      log(`  Adapter info: ${adapter ? "Found" : "None"}`);
      const t0 = performance.now();
      statusEl.textContent = "Loading model via WebGPU ...";
      log("Creating InferenceSession with EP: ['webgpu'] ...");
      const webgpuSession = await ort.InferenceSession.create("/eval/p2-model-poc/model.onnx", {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "basic",
      });
      const webgpuLoadMs = performance.now() - t0;
      log(`[PASS] WebGPU Session created in ${webgpuLoadMs.toFixed(1)} ms`, "pass");

      const T = 200;
      const dummySignal = new Float32Array(1 * 80 * T);
      const tensorSignal = new ort.Tensor("float32", dummySignal, [1, 80, T]);
      const tensorLen = new ort.Tensor("int64", new BigInt64Array([BigInt(T)]), [1]);

      const tInf0 = performance.now();
      const webgpuOut = await webgpuSession.run({
        audio_signal: tensorSignal,
        length: tensorLen,
      });
      const webgpuInfMs = performance.now() - tInf0;
      const logprobs = webgpuOut.logprobs;
      log(`[PASS] WebGPU Inference succeeded in ${webgpuInfMs.toFixed(1)} ms`, "pass");
      log(`  Output dims: ${JSON.stringify(logprobs.dims)}`);

      testsRecord["webgpu"] = {
        status: "PASS",
        load_ms: webgpuLoadMs,
        inference_ms: webgpuInfMs,
        output_dims: logprobs.dims,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`[FAIL/BLOCKED] WebGPU execution failed: ${errMsg}`, "fail");
      testsRecord["webgpu"] = {
        status: "FAIL",
        error: errMsg,
      };
    }
  }

  // Save results back to dev server
  log("\nPosting results to /eval-results/browser_runtime_test_results.json ...");
  try {
    const resp = await fetch("/eval-results/browser_runtime_test_results.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testResults, null, 2),
    });
    if (resp.ok) {
      log("[PASS] Results persisted successfully!", "pass");
      statusEl.textContent = "Test suite completed and saved.";
    } else {
      log(`[WARN] Results post returned ${resp.status}`, "warn");
    }
  } catch (e) {
    log(`[WARN] Could not post results: ${e}`, "warn");
  }
}

void runTests();
