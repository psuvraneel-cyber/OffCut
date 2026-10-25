import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const sourcePath = path.join(
  projectRoot,
  "asr-evaluation-assets",
  "01_english_podcast",
  "transcripts",
  "source_transcript.txt"
);

const derivedDir = path.join(projectRoot, "asr-evaluation-assets", "derived");
const targetPath = path.join(derivedDir, "EN_PODCAST_FULL_reference.txt");

if (!fs.existsSync(sourcePath)) {
  console.error("Source transcript not found at:", sourcePath);
  process.exit(1);
}

const lines = fs.readFileSync(sourcePath, "utf-8").split(/\r?\n/);
if (lines.length < 3) {
  console.error("source_transcript.txt has fewer than 3 lines.");
  process.exit(1);
}

const line3 = lines[2];

const expectedStart = "ANNOUNCER: This is Planet Money from NPR.";
const expectedContent = "Thanks for listening.";

if (!line3.startsWith(expectedStart)) {
  console.error(`Line 3 does not start with expected prefix.\nExpected: "${expectedStart}"\nActual start: "${line3.slice(0, 50)}"`);
  process.exit(1);
}

if (!line3.includes(expectedContent)) {
  console.error(`Line 3 does not contain expected phrase "${expectedContent}".`);
  process.exit(1);
}

if (!fs.existsSync(derivedDir)) {
  fs.mkdirSync(derivedDir, { recursive: true });
}

fs.writeFileSync(targetPath, line3, "utf-8");
console.log(`Wrote ${line3.length} characters unchanged to ${targetPath}`);

// Import normalizeForScoring or inline the same pure normalizer to display first 300 normalized characters
let normalizeForScoring;
try {
  const mod = await import("./wer.ts");
  normalizeForScoring = mod.normalizeForScoring;
} catch {
  // Fallback if ts import isn't supported without flags
  normalizeForScoring = (text) => {
    let s = text.normalize("NFC");
    s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
    s = s.replace(/\[[^\]]*\]/g, "");
    s = s.replace(/\([^)]*\)/g, "");
    const speakerRegex = /(?:^|[\r\n]+|(?<=[\.!\?\]"”’'—–-]))\s*((?:[A-Z]+(?:['\-][A-Z]+)*|[A-Z]\.)(?:\s+(?:[A-Z]+(?:['\-][A-Z]+)*|[A-Z]\.)){0,3}):\s*/g;
    let prev;
    do {
      prev = s;
      s = s.replace(speakerRegex, " ");
    } while (s !== prev);
    s = s.replace(/\b([A-Za-z]+)\s+(['’])\s*([A-Za-z]+)\b/g, "$1'$3");
    s = s.toLowerCase();
    s = s.replace(/--|—|–|-/g, " ");
    s = s.replace(/[।॥]/g, " ");
    s = s.replace(/[^\p{L}\p{M}\p{N}\s%']/gu, " ");
    s = s.replace(/(?<![\p{L}\p{M}\p{N}])'|'(?![\p{L}\p{M}\p{N}])/gu, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  };
}

const normalized = normalizeForScoring(line3);
console.log("\nFirst 300 characters after normalization:");
console.log(normalized.slice(0, 300));
