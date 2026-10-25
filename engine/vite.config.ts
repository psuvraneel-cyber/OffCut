import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: false,
  css: {
    postcss: {},
  },
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
