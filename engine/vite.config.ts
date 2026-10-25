import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const evalAssetsDir = path.resolve(projectRoot, "asr-evaluation-assets");
const evalResultsDir = path.resolve(evalAssetsDir, "results");
const resultsMdPath = path.resolve(__dirname, "bench", "RESULTS.md");

function evalAssetsPlugin(): Plugin {
  return {
    name: "eval-assets-dev-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? "";
        const cleanUrl = rawUrl.split("?")[0];

        // 1. GET / HEAD /eval/*
        if ((req.method === "GET" || req.method === "HEAD") && cleanUrl.startsWith("/eval/")) {
          const subPath = decodeURIComponent(cleanUrl.slice("/eval/".length));
          const targetPath = path.resolve(evalAssetsDir, subPath);

          if (!targetPath.startsWith(evalAssetsDir + path.sep) && targetPath !== evalAssetsDir) {
            res.statusCode = 403;
            res.end("Forbidden: Path escapes evaluation directory");
            return;
          }

          if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
            res.statusCode = 404;
            res.end("Not Found");
            return;
          }

          const stat = fs.statSync(targetPath);
          const ext = path.extname(targetPath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".flac": "audio/flac",
            ".json": "application/json; charset=utf-8",
            ".txt": "text/plain; charset=utf-8",
          };
          const contentType = mimeTypes[ext] ?? "application/octet-stream";

          if (req.method === "HEAD") {
            res.statusCode = 200;
            res.setHeader("Content-Length", stat.size);
            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            res.end();
            return;
          }

          const rangeHeader = req.headers.range;
          if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
            if (start >= stat.size || end >= stat.size) {
              res.statusCode = 416;
              res.setHeader("Content-Range", `bytes */${stat.size}`);
              res.end();
              return;
            }
            res.statusCode = 206;
            res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Content-Length", end - start + 1);
            res.setHeader("Content-Type", contentType);
            fs.createReadStream(targetPath, { start, end }).pipe(res);
          } else {
            res.statusCode = 200;
            res.setHeader("Content-Length", stat.size);
            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            fs.createReadStream(targetPath).pipe(res);
          }
          return;
        }

        // 2. POST /eval-results/<name>.json
        if (req.method === "POST" && cleanUrl.startsWith("/eval-results/")) {
          const rawName = cleanUrl.slice("/eval-results/".length);
          const safeName = path.basename(rawName);

          if (!/^[a-zA-Z0-9_\-\.]+\.json$/.test(safeName)) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid results filename" }));
            return;
          }

          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              if (!fs.existsSync(evalResultsDir)) {
                fs.mkdirSync(evalResultsDir, { recursive: true });
              }

              const targetJsonPath = path.join(evalResultsDir, safeName);
              fs.writeFileSync(targetJsonPath, body, "utf-8");

              // Append numbers-only summary to engine/bench/RESULTS.md if summary markdown is provided
              const data = JSON.parse(body);
              if (data && typeof data.summaryTableMd === "string" && data.summaryTableMd.trim().length > 0) {
                const header = `\n\n## Run: ${data.label ?? safeName} (${new Date().toISOString()})\n\n`;
                fs.appendFileSync(resultsMdPath, header + data.summaryTableMd + "\n", "utf-8");
              }

              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, path: targetJsonPath }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: false,
  css: {
    postcss: {},
  },
  plugins: [evalAssetsPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "index.html",
        demo: "demo/index.html",
        library: "src/index.ts",
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "library" ? "library/index.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
  },
});
