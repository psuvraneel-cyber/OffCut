import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const userDataDir = path.resolve("C:\\OffCut\\.chrome-bench-profile");
const resultsPath = path.resolve("D:\\OffCut-Evaluation\\reports\\results\\browser_runtime_test_results.json");

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("==================================================================");
  console.log("Launching IndicConformer Browser Runtime Verification Test");
  console.log("==================================================================");

  // 1. Start Vite dev server if not already running
  let vite = null;
  try {
    const res = await fetch("http://127.0.0.1:5180");
    console.log("Vite dev server is already running (status " + res.status + ")");
  } catch {
    console.log("Starting Vite dev server on port 5180 ...");
    vite = spawn("npm.cmd", ["--prefix", "engine", "run", "dev"], {
      stdio: "inherit",
      shell: true,
    });
    // Wait for server to be responsive
    for (let i = 0; i < 20; i++) {
      await wait(1000);
      try {
        const check = await fetch("http://127.0.0.1:5180");
        if (check.ok) {
          console.log("Vite server ready!");
          break;
        }
      } catch {}
    }
  }

  // 2. Launch Chrome
  console.log("Launching Chrome with remote debugging on port 9222 ...");
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

  // 3. Connect to CDP
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
    if (vite) vite.kill();
    process.exit(1);
  }

  const { WebSocket } = await import("ws");
  const ws = new WebSocket(wsUrl);

  let msgId = 1;
  const pending = new Map();
  function sendCdp(method, params = {}) {
    return new Promise((resolve) => {
      const id = msgId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.result);
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      console.log("[Chrome Console]:", args);
    }
  });

  await new Promise((resolve) => ws.on("open", resolve));
  await sendCdp("Runtime.enable");
  await sendCdp("Page.enable");

  // Remove previous result if exists
  if (fs.existsSync(resultsPath)) {
    fs.unlinkSync(resultsPath);
  }

  const targetUrl = "http://127.0.0.1:5180/bench/test-conformer.html";
  console.log("Navigating Chrome to:", targetUrl);
  await sendCdp("Page.navigate", { url: targetUrl });

  // Poll for completion
  console.log("Waiting for browser test execution ...");
  let completed = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    if (fs.existsSync(resultsPath)) {
      try {
        const content = fs.readFileSync(resultsPath, "utf-8");
        const json = JSON.parse(content);
        if (json.tests) {
          console.log("Browser test results saved successfully!");
          completed = true;
          break;
        }
      } catch {}
    }
  }

  // Close chrome
  chrome.kill();
  if (vite) vite.kill();

  if (completed) {
    console.log("==================================================================");
    console.log("Test Completed! Results at:", resultsPath);
    console.log(fs.readFileSync(resultsPath, "utf-8"));
    console.log("==================================================================");
    process.exit(0);
  } else {
    console.error("Test timed out before results were saved.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
