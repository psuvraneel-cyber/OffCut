import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = path.resolve("C:\\OffCut\\.chrome-bench-profile");
const resultsDir = path.resolve("D:\\OffCut-Evaluation\\reports\\results");

if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

const EXPERIMENTS = [
  {
    name: "expA_tiny_rec_off",
    model: "tiny",
    recovery: "none",
    query: "label=p1_1_expA_tiny_rec_off&model=tiny&device=webgpu&vad=on&recovery=none&manifest=manifests/offcut_benchmark_manifest.json",
    description: "Whisper Tiny on WebGPU with Recovery OFF (baseline)",
  },
  {
    name: "expB_tiny_rec_on",
    model: "tiny",
    recovery: "ladder",
    query: "label=p1_1_expB_tiny_rec_on&model=tiny&device=webgpu&vad=on&recovery=ladder&manifest=manifests/offcut_benchmark_manifest.json",
    description: "Whisper Tiny on WebGPU with Recovery ON (ladder)",
  },
  {
    name: "expC_base_rec_off",
    model: "base",
    recovery: "none",
    query: "label=p1_1_expC_base_rec_off&model=base&device=webgpu&vad=on&recovery=none&manifest=manifests/offcut_benchmark_manifest.json",
    description: "Whisper Base on WebGPU with Recovery OFF (baseline)",
  },
  {
    name: "expD_base_rec_on",
    model: "base",
    recovery: "ladder",
    query: "label=p1_1_expD_base_rec_on&model=base&device=webgpu&vad=on&recovery=ladder&manifest=manifests/offcut_benchmark_manifest.json",
    description: "Whisper Base on WebGPU with Recovery ON (ladder)",
  },
];

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("==================================================================");
  console.log("Starting Phase 2 P1.1 Browser-Based Model Benchmark Matrix Runner");
  console.log("==================================================================");

  console.log("Launching Chrome with remote debugging on port 9222...");
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${userDataDir}`,
      "--remote-debugging-port=9222",
      "--enable-unsafe-webgpu",
      "--use-webgpu-adapter=integrated",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  await wait(2500);

  // Find target tab
  let wsUrl = null;
  for (let i = 0; i < 15; i++) {
    try {
      const resp = await fetch("http://127.0.0.1:9222/json/list");
      const list = await resp.json();
      if (list.length > 0 && list[0].webSocketDebuggerUrl) {
        wsUrl = list[0].webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await wait(1000);
  }

  if (!wsUrl) {
    console.error("Could not find Chrome CDP target!");
    chrome.kill();
    process.exit(1);
  }

  console.log("Connected to Chrome CDP:", wsUrl);
  const ws = new WebSocket(wsUrl);

  let idCounter = 1;
  const pendingRequests = new Map();

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      resolve(data.result);
    }
  };

  await new Promise((resolve) => {
    ws.onopen = resolve;
  });

  await sendCommand("Runtime.enable");
  await sendCommand("Page.enable");

  const runPayloads = {};

  for (let expIdx = 0; expIdx < EXPERIMENTS.length; expIdx++) {
    const exp = EXPERIMENTS[expIdx];
    const url = `http://127.0.0.1:5180/bench/index.html?${exp.query}`;

    console.log(`\n------------------------------------------------------------------`);
    console.log(`[Matrix Run ${expIdx + 1}/4] ${exp.description}`);
    console.log(`URL: ${url}`);
    console.log(`------------------------------------------------------------------`);

    // Reset window.__benchResults and navigate
    await sendCommand("Runtime.evaluate", { expression: "delete window.__benchResults;" });
    await sendCommand("Page.navigate", { url });

    let finished = false;
    let lastBox = "";
    const startTime = Date.now();
    const MAX_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes max per experiment

    while (!finished) {
      await wait(3000);

      if (Date.now() - startTime > MAX_TIMEOUT_MS) {
        console.error(`Timeout exceeded (${MAX_TIMEOUT_MS / 1000}s) for ${exp.name}`);
        break;
      }

      const evalRes = await sendCommand("Runtime.evaluate", {
        expression: `({
          title: document.getElementById('status-title')?.textContent || '',
          box: document.getElementById('status-box')?.textContent || '',
          hasResults: Boolean(window.__benchResults)
        })`,
        returnByValue: true,
      });

      const val = evalRes?.result?.value;
      if (val) {
        if (val.box !== lastBox && val.box) {
          lastBox = val.box;
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          console.log(`[${exp.name}] [${elapsedSec}s] ${val.title}: ${val.box}`);
        }

        if (val.title === "Benchmark Finished!" || val.hasResults) {
          console.log(`\n✓ Experiment completed: ${exp.name}`);
          finished = true;
        } else if (val.title === "Benchmark Error") {
          console.error(`\n✗ Experiment failed: ${exp.name} - ${val.box}`);
          finished = true;
        }
      }
    }

    // Retrieve full payload from browser
    const resultsRes = await sendCommand("Runtime.evaluate", {
      expression: `JSON.stringify(window.__benchResults)`,
      returnByValue: true,
    });

    const benchPayload = JSON.parse(resultsRes?.result?.value ?? "{}");
    runPayloads[exp.name] = benchPayload;

    // Save direct experiment JSON artifact
    const targetFile = path.join(resultsDir, `${exp.name}.json`);
    fs.writeFileSync(targetFile, JSON.stringify(benchPayload, null, 2), "utf-8");
    console.log(`Saved immutable run artifact: ${targetFile}`);

    // Print summary stats
    if (benchPayload.categorySummaries) {
      console.log(`\nCategory Summaries for ${exp.name}:`);
      for (const sum of benchPayload.categorySummaries) {
        console.log(
          `  - ${sum.groupKey} [${sum.profile}]: Samples=${sum.samples}, MicroWER=${(sum.microWer * 100).toFixed(2)}%, MacroWER=${(sum.macroWer * 100).toFixed(2)}%, DelRate=${(sum.microDelRate * 100).toFixed(2)}%, MeanCER=${(sum.meanCer * 100).toFixed(2)}%, RTF=${sum.meanRtf.toFixed(3)}`
        );
      }
    }
    if (benchPayload.sourceSummaries) {
      console.log(`\nSource Dataset Summaries for ${exp.name}:`);
      for (const sum of benchPayload.sourceSummaries) {
        console.log(
          `  - ${sum.groupKey} [${sum.profile}]: Samples=${sum.samples}, MicroWER=${(sum.microWer * 100).toFixed(2)}%, MacroWER=${(sum.macroWer * 100).toFixed(2)}%, DelRate=${(sum.microDelRate * 100).toFixed(2)}%, MeanCER=${(sum.meanCer * 100).toFixed(2)}%`
        );
      }
    }
  }

  ws.close();
  chrome.kill();

  console.log("\n==================================================================");
  console.log("All 4 Matrix Experiments Finished. Computing Consolidated Deliverables...");
  console.log("==================================================================");

  // Write Section 16 Machine-Readable Result Deliverables
  // 1. tiny_results.json
  const tinyResults = {
    model: "tiny",
    baseline_recovery_off: runPayloads["expA_tiny_rec_off"],
    recovery_on: runPayloads["expB_tiny_rec_on"],
  };
  fs.writeFileSync(path.join(resultsDir, "tiny_results.json"), JSON.stringify(tinyResults, null, 2), "utf-8");
  console.log(`Saved: ${path.join(resultsDir, "tiny_results.json")}`);

  // 2. base_results.json
  const baseResults = {
    model: "base",
    baseline_recovery_off: runPayloads["expC_base_rec_off"],
    recovery_on: runPayloads["expD_base_rec_on"],
  };
  fs.writeFileSync(path.join(resultsDir, "base_results.json"), JSON.stringify(baseResults, null, 2), "utf-8");
  console.log(`Saved: ${path.join(resultsDir, "base_results.json")}`);

  // 3. recovery_ablation_results.json
  const recoveryAblation = {
    tiny: {
      rec_off_summary: runPayloads["expA_tiny_rec_off"]?.categorySummaries,
      rec_on_summary: runPayloads["expB_tiny_rec_on"]?.categorySummaries,
      rec_off_sources: runPayloads["expA_tiny_rec_off"]?.sourceSummaries,
      rec_on_sources: runPayloads["expB_tiny_rec_on"]?.sourceSummaries,
    },
    base: {
      rec_off_summary: runPayloads["expC_base_rec_off"]?.categorySummaries,
      rec_on_summary: runPayloads["expD_base_rec_on"]?.categorySummaries,
      rec_off_sources: runPayloads["expC_base_rec_off"]?.sourceSummaries,
      rec_on_sources: runPayloads["expD_base_rec_on"]?.sourceSummaries,
    },
  };
  fs.writeFileSync(path.join(resultsDir, "recovery_ablation_results.json"), JSON.stringify(recoveryAblation, null, 2), "utf-8");
  console.log(`Saved: ${path.join(resultsDir, "recovery_ablation_results.json")}`);

  // 4. model_comparison.json
  const modelComparison = {
    expA_tiny_rec_off: {
      categorySummaries: runPayloads["expA_tiny_rec_off"]?.categorySummaries,
      sourceSummaries: runPayloads["expA_tiny_rec_off"]?.sourceSummaries,
    },
    expB_tiny_rec_on: {
      categorySummaries: runPayloads["expB_tiny_rec_on"]?.categorySummaries,
      sourceSummaries: runPayloads["expB_tiny_rec_on"]?.sourceSummaries,
    },
    expC_base_rec_off: {
      categorySummaries: runPayloads["expC_base_rec_off"]?.categorySummaries,
      sourceSummaries: runPayloads["expC_base_rec_off"]?.sourceSummaries,
    },
    expD_base_rec_on: {
      categorySummaries: runPayloads["expD_base_rec_on"]?.categorySummaries,
      sourceSummaries: runPayloads["expD_base_rec_on"]?.sourceSummaries,
    },
  };
  fs.writeFileSync(path.join(resultsDir, "model_comparison.json"), JSON.stringify(modelComparison, null, 2), "utf-8");
  console.log(`Saved: ${path.join(resultsDir, "model_comparison.json")}`);

  // 5. sample_level_metrics.csv
  const sampleCsvLines = [
    "experiment,sample_id,category,source_dataset,language,profile,duration_seconds,ref_words,hyp_words,wer,substitutions,deletions,insertions,deletion_rate,cer,wall_time_ms,rtf,reference_verified",
  ];
  for (const exp of EXPERIMENTS) {
    const payload = runPayloads[exp.name];
    if (payload?.results) {
      for (const r of payload.results) {
        const hypWordsCount = r.stats?.windows ? r.wordErrors.referenceWords - r.wordErrors.deletions + r.wordErrors.insertions : r.hypothesisText.split(/\s+/).filter(Boolean).length;
        sampleCsvLines.push(
          [
            exp.name,
            r.id,
            r.category,
            r.sourceDataset ?? "",
            r.language,
            r.scoringProfile,
            r.duration.toFixed(3),
            r.wordErrors.referenceWords,
            hypWordsCount,
            r.wordErrors.wer.toFixed(4),
            r.wordErrors.substitutions,
            r.wordErrors.deletions,
            r.wordErrors.insertions,
            r.deletionRate.toFixed(4),
            r.charErrors.cer.toFixed(4),
            r.wallTimeMs.toFixed(1),
            r.rtf.toFixed(4),
            r.referenceVerified ? "true" : "false",
          ].join(",")
        );
      }
    }
  }
  fs.writeFileSync(path.join(resultsDir, "sample_level_metrics.csv"), sampleCsvLines.join("\n"), "utf-8");
  console.log(`Saved: ${path.join(resultsDir, "sample_level_metrics.csv")}`);

  console.log("\nAll Phase 2 P1.1 benchmark runs and result artifacts successfully produced!");
}

main().catch((err) => {
  console.error("Fatal matrix execution error:", err);
  process.exit(1);
});
