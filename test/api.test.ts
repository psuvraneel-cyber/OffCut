import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleErrorReport } from "../functions/api/errors";
import type { Env } from "../functions/lib/env";

const ORIGIN = "http://localhost:8788";
const TEST_ENV = env as unknown as Env;
const VOTER_ID = "123e4567-e89b-42d3-a456-426614174000";

let turnstileResult = true;

beforeEach(() => {
  turnstileResult = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ success: turnstileResult }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

describe("health", () => {
  it("returns 200 with a version", async () => {
    const response = await SELF.fetch(new Request("http://localhost/api/health"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, version: "0.0.1" });
    expect(typeof body.time).toBe("string");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("waitlist", () => {
  it("creates a signup and treats a differently-cased duplicate as already joined", async () => {
    const first = await post("/api/waitlist", {
      email: "Creator@Example.com",
      consent: true,
      source: "hero",
      turnstileToken: "token",
    });
    const duplicate = await post("/api/waitlist", {
      email: "CREATOR@example.com",
      consent: true,
      turnstileToken: "token",
    });

    expect(first.response.status).toBe(201);
    expect(first.body).toMatchObject({ ok: true, alreadyJoined: false });
    expect(duplicate.response.status).toBe(200);
    expect(duplicate.body).toMatchObject({ ok: true, alreadyJoined: true });
  });

  it("rejects missing consent, invalid email, failed Turnstile, bad origin, and oversized bodies", async () => {
    const missingConsent = await post("/api/waitlist", {
      email: "missing@example.com",
      consent: false,
      turnstileToken: "token",
    });
    expect(missingConsent.response.status).toBe(400);
    expect(missingConsent.body.error.code).toBe("VALIDATION_ERROR");

    const badEmail = await post("/api/waitlist", {
      email: "not-an-email",
      consent: true,
      turnstileToken: "token",
    });
    expect(badEmail.response.status).toBe(400);
    expect(badEmail.body.error.fields.email).toBeTruthy();

    turnstileResult = false;
    const failedTurnstile = await post("/api/waitlist", {
      email: "bot@example.com",
      consent: true,
      turnstileToken: "token",
    });
    expect(failedTurnstile.response.status).toBe(403);
    expect(failedTurnstile.body.error.code).toBe("TURNSTILE_FAILED");

    turnstileResult = true;
    const missingToken = await post("/api/waitlist", {
      email: "notoken@example.com",
      consent: true,
    });
    expect(missingToken.response.status).toBe(403);
    expect(missingToken.body.error.code).toBe("TURNSTILE_FAILED");

    const badOrigin = await post(
      "/api/waitlist",
      {
        email: "origin@example.com",
        consent: true,
        turnstileToken: "token",
      },
      "https://evil.example",
    );
    expect(badOrigin.response.status).toBe(403);
    expect(badOrigin.body.error.code).toBe("FORBIDDEN_ORIGIN");

    const oversized = await post("/api/waitlist", {
      email: "large@example.com",
      consent: true,
      source: "x".repeat(11_000),
      turnstileToken: "token",
    });
    expect(oversized.response.status).toBe(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("waitlist removal", () => {
  it("returns 200 for present and absent emails and removes the signup", async () => {
    await post("/api/waitlist", {
      email: "remove@example.com",
      consent: true,
      turnstileToken: "token",
    });

    const removed = await post("/api/waitlist/remove", {
      email: "REMOVE@example.com",
      turnstileToken: "token",
    });
    const absent = await post("/api/waitlist/remove", {
      email: "absent@example.com",
      turnstileToken: "token",
    });
    const row = await TEST_ENV.DB.prepare("SELECT email FROM waitlist WHERE email = ?1")
      .bind("remove@example.com")
      .first<{ email: string }>();

    expect(removed.response.status).toBe(200);
    expect(removed.body).toMatchObject({ ok: true });
    expect(absent.response.status).toBe(200);
    expect(absent.body).toMatchObject({ ok: true });
    expect(row).toBeNull();
  });
});

describe("feedback", () => {
  it("accepts valid feedback and rejects a too-short message", async () => {
    const valid = await post("/api/feedback", {
      category: "idea",
      message: "Please add keyboard shortcuts.",
      contact: "Creator@Example.com",
      meta: { browser: "Chrome 155", webgpu: true },
      turnstileToken: "token",
    });
    const tooShort = await post("/api/feedback", {
      category: "bug",
      message: "no",
      turnstileToken: "token",
    });

    expect(valid.response.status).toBe(201);
    expect(valid.body).toMatchObject({ ok: true });
    expect(typeof valid.body.id).toBe("number");
    expect(tooShort.response.status).toBe(400);
    expect(tooShort.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("features and votes", () => {
  it("sorts features by status and vote count", async () => {
    await TEST_ENV.DB.batch([
      TEST_ENV.DB.prepare(
        "INSERT INTO feature_votes (feature_id, voter_id) VALUES (?1, ?2)",
      ).bind("hindi-captions", VOTER_ID),
      TEST_ENV.DB.prepare(
        "INSERT INTO feature_votes (feature_id, voter_id) VALUES (?1, ?2)",
      ).bind("hindi-captions", "223e4567-e89b-42d3-a456-426614174000"),
      TEST_ENV.DB.prepare(
        "INSERT INTO feature_votes (feature_id, voter_id) VALUES (?1, ?2)",
      ).bind("caption-styles", "323e4567-e89b-42d3-a456-426614174000"),
    ]);

    const response = await SELF.fetch(new Request("http://localhost/api/features"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(body.features.map((feature: { id: string }) => feature.id)).toEqual([
      "hindi-captions",
      "caption-styles",
      "batch-export",
      "auto-broll",
      "desktop-app",
    ]);
    expect(body.features[0].votes).toBe(2);
    expect(body.features[1].votes).toBe(1);
  });

  it("makes votes idempotent and supports idempotent unvoting", async () => {
    const first = await post(`/api/features/hindi-captions/vote`, {
      voterId: VOTER_ID,
      turnstileToken: "token",
    });
    const duplicate = await post(`/api/features/hindi-captions/vote`, {
      voterId: VOTER_ID,
      turnstileToken: "token",
    });
    const removed = await removeVote(`/api/features/hindi-captions/vote`, {
      voterId: VOTER_ID,
      turnstileToken: "token",
    });
    const removedAgain = await removeVote(`/api/features/hindi-captions/vote`, {
      voterId: VOTER_ID,
      turnstileToken: "token",
    });

    expect(first.body).toMatchObject({ ok: true, votes: 1, voted: true });
    expect(duplicate.body).toMatchObject({ ok: true, votes: 1, voted: true });
    expect(removed.body).toMatchObject({ ok: true, votes: 0, voted: false });
    expect(removedAgain.body).toMatchObject({ ok: true, votes: 0, voted: false });
  });

  it("returns 404 for an unknown feature, 409 for shipped features, and 400 for an invalid voter id", async () => {
    const unknown = await post("/api/features/does-not-exist/vote", {
      voterId: VOTER_ID,
      turnstileToken: "token",
    });
    expect(unknown.response.status).toBe(404);

    await TEST_ENV.DB.prepare("UPDATE features SET status = ?1 WHERE id = ?2")
      .bind("shipped", "desktop-app")
      .run();
    const shipped = await post("/api/features/desktop-app/vote", {
      voterId: VOTER_ID,
      turnstileToken: "token",
    });
    expect(shipped.response.status).toBe(409);
    expect(shipped.body.error.code).toBe("CONFLICT");

    const invalidVoter = await post("/api/features/hindi-captions/vote", {
      voterId: "not-a-uuid",
      turnstileToken: "token",
    });
    expect(invalidVoter.response.status).toBe(400);
  });
});

describe("stats", () => {
  it("atomically increments both counters and exposes cached totals", async () => {
    const exported = await post("/api/stats/export", {
      clips: 2,
      sourceMinutes: 3.14,
      turnstileToken: "token",
    });
    const stats = await SELF.fetch(new Request("http://localhost/api/stats"));
    const body = await readJson(stats);

    expect(exported.response.status).toBe(202);
    expect(body).toMatchObject({ ok: true, clipsExported: 2, minutesProcessed: 3.1 });
    expect(typeof body.updatedAt).toBe("string");
    expect(stats.headers.get("Cache-Control")).toBe("public, max-age=60");

    const invalidClips = await post("/api/stats/export", {
      clips: 21,
      sourceMinutes: 0,
      turnstileToken: "token",
    });
    const invalidMinutes = await post("/api/stats/export", {
      clips: 1,
      sourceMinutes: -1,
      turnstileToken: "token",
    });
    expect(invalidClips.response.status).toBe(400);
    expect(invalidMinutes.response.status).toBe(400);
  });
});

describe("error reports", () => {
  it("truncates long messages to 500 characters", async () => {
    const response = await post("/api/errors", {
      stage: "encode",
      errorName: "EncodingError",
      message: "x".repeat(700),
      turnstileToken: "token",
    });
    const row = await TEST_ENV.DB.prepare("SELECT message FROM error_reports ORDER BY id DESC LIMIT 1")
      .bind()
      .first<{ message: string }>();

    expect(response.response.status).toBe(202);
    expect(row?.message).toHaveLength(500);
  });

  it("deletes only reports older than 90 days when cleanup is sampled", async () => {
    const now = Date.now();
    const oldDate = new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString();
    const newDate = new Date(now - 89 * 24 * 60 * 60 * 1000).toISOString();
    await TEST_ENV.DB.batch([
      TEST_ENV.DB.prepare(
        "INSERT INTO error_reports (stage, error_name, message, created_at) VALUES (?1, ?2, ?3, ?4)",
      ).bind("load", "OldError", "old", oldDate),
      TEST_ENV.DB.prepare(
        "INSERT INTO error_reports (stage, error_name, message, created_at) VALUES (?1, ?2, ?3, ?4)",
      ).bind("load", "NewError", "new", newDate),
    ]);

    const pending: Promise<unknown>[] = [];
    const response = await handleErrorReport(
      requestFor("/api/errors", {
        stage: "load",
        errorName: "CurrentError",
        message: "current",
        turnstileToken: "token",
      }),
      TEST_ENV,
      (promise) => pending.push(promise),
      () => 0,
    );
    await Promise.all(pending);

    const oldRow = await TEST_ENV.DB.prepare("SELECT id FROM error_reports WHERE error_name = ?1")
      .bind("OldError")
      .first<{ id: number }>();
    const newRow = await TEST_ENV.DB.prepare("SELECT id FROM error_reports WHERE error_name = ?1")
      .bind("NewError")
      .first<{ id: number }>();
    const currentRow = await TEST_ENV.DB.prepare("SELECT id FROM error_reports WHERE error_name = ?1")
      .bind("CurrentError")
      .first<{ id: number }>();

    expect(response.status).toBe(202);
    expect(oldRow).toBeNull();
    expect(newRow).not.toBeNull();
    expect(currentRow).not.toBeNull();
  });
});

describe("routing", () => {
  it("returns JSON 404s for unknown API routes and 405s with Allow for wrong methods", async () => {
    const unknown = await SELF.fetch(new Request("http://localhost/api/not-real"));
    const wrongMethod = await SELF.fetch(new Request("http://localhost/api/waitlist"));
    const unknownBody = await readJson(unknown);
    const wrongMethodBody = await readJson(wrongMethod);

    expect(unknown.status).toBe(404);
    expect(unknownBody.error.code).toBe("NOT_FOUND");
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("POST");
    expect(wrongMethodBody.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(wrongMethodBody.error.message).toBe("Method not allowed.");
  });
});

async function post(path: string, body: unknown, origin = ORIGIN) {
  const response = await SELF.fetch(requestFor(path, body, "POST", origin));
  return { response, body: await readJson(response) };
}

async function removeVote(path: string, body: unknown) {
  const response = await SELF.fetch(requestFor(path, body, "DELETE"));
  return { response, body: await readJson(response) };
}

function requestFor(path: string, body: unknown, method = "POST", origin = ORIGIN): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<any> {
  return response.json();
}
