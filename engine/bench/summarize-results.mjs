// Read-only: prints a numbers-only summary of benchmark result files. Never prints transcript text.
// Usage: node summarize-results.mjs <resultsDir> <filenamePrefix>
import fs from "node:fs";
import path from "node:path";

const [dir, prefix] = process.argv.slice(2);
if (!dir || !prefix) {
  console.error("Usage: node summarize-results.mjs <resultsDir> <filenamePrefix>");
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
if (files.length === 0) {
  console.error(`No result files starting with "${prefix}" in ${dir}`);
  process.exit(1);
}

const pct = (x) => (x * 100).toFixed(1) + "%";
const tokens = (text) => text.split(/\s+/).filter(Boolean);
const junkCount = (text) => tokens(text).filter((t) => !/[\p{L}\p{N}]/u.test(t)).length;

function longestRepeat(text) {
  const t = tokens(text).map((w) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "")).filter(Boolean);
  let best = 1;
  for (let len = 1; len <= 4; len++) {
    for (let i = 0; i + len <= t.length; i++) {
      let k = 1;
      while (i + (k + 1) * len <= t.length && t.slice(i + k * len, i + (k + 1) * len).join(" ") === t.slice(i, i + len).join(" ")) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  console.log(`\n### ${file}`);
  console.log(`label=${data.label} model=${data.model} device=${data.device} vad=${data.vad} set=${data.set} runs=${data.runs}`);
  console.log("| Run | Sample | Lang | Detected | Ref W | Hyp W | WER | S | D | I | Del rate | CER | Max gap s | Words in silence | Junk tokens | Max repeats | Wall s | RTF | VAD | dtype | Windows | Retried |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const flags = [];
  for (const r of data.results) {
    const w = r.wordErrors;
    const hyp = r.hypothesisText ?? "";
    const hypWords = tokens(hyp).length;
    const junk = junkCount(hyp);
    const rep = longestRepeat(hyp);
    const s = r.stats ?? {};
    console.log(`| ${r.runIndex} | ${r.id} | ${r.language} | ${r.detectedLanguage} | ${w.referenceWords} | ${hypWords} | ${pct(w.wer)} | ${w.substitutions} | ${w.deletions} | ${w.insertions} | ${pct(r.deletionRate)} | ${pct(r.charErrors.cer)} | ${r.maxGapSeconds.toFixed(2)} | ${r.wordsInSilence} | ${junk} | ${rep} | ${(r.wallTimeMs / 1000).toFixed(1)} | ${r.rtf.toFixed(3)} | ${s.vad ?? "-"} | ${s.dtype ?? "-"} | ${s.windows ?? "-"} | ${s.retriedWindows ?? "-"} |`);
    if (w.referenceWords > 0 && hypWords === 0) flags.push(`${r.id}/${r.language} run ${r.runIndex}: EMPTY output`);
    if (junk > 0) flags.push(`${r.id}/${r.language} run ${r.runIndex}: ${junk} junk tokens`);
    if (rep >= 4) flags.push(`${r.id}/${r.language} run ${r.runIndex}: phrase repeated ${rep}x in a row`);
    if (r.wordsInSilence > 0) flags.push(`${r.id}/${r.language} run ${r.runIndex}: ${r.wordsInSilence} words in silence`);
    if (data.vad && s.vad !== "silero") flags.push(`${r.id}/${r.language} run ${r.runIndex}: VAD status ${s.vad}`);
  }
  console.log(flags.length ? "\nFLAGS:\n- " + flags.join("\n- ") : "\nFLAGS: none");
}
