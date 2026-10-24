import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        vars: {
          TURNSTILE_SECRET_KEY: "test-secret",
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.resolve("migrations")),
        },
      },
    })),
  ],
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
