import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach } from "vitest";
import type { Env } from "../functions/lib/env";

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM feature_votes").bind(),
    testEnv.DB.prepare("DELETE FROM waitlist").bind(),
    testEnv.DB.prepare("DELETE FROM feedback").bind(),
    testEnv.DB.prepare("DELETE FROM error_reports").bind(),
    testEnv.DB.prepare("UPDATE stats SET value = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(),
    testEnv.DB.prepare("UPDATE features SET status = ?1 WHERE id = ?2").bind("idea", "hindi-captions"),
    testEnv.DB.prepare("UPDATE features SET status = ?1 WHERE id = ?2").bind("idea", "caption-styles"),
    testEnv.DB.prepare("UPDATE features SET status = ?1 WHERE id = ?2").bind("idea", "batch-export"),
    testEnv.DB.prepare("UPDATE features SET status = ?1 WHERE id = ?2").bind("idea", "auto-broll"),
    testEnv.DB.prepare("UPDATE features SET status = ?1 WHERE id = ?2").bind("planned", "desktop-app"),
  ]);
});
