import type { PagesFunction } from "@cloudflare/workers-types";
import type { ErrorReportRequest } from "../../shared/api-types";
import type { Env } from "../lib/env";
import { parseJsonBody } from "../lib/body";
import { retentionCutoffIso, serializeMeta } from "../lib/db";
import { jsonResponse, methodNotAllowed, turnstileFailedResponse } from "../lib/responses";
import { errorReportSchema } from "../lib/schemas";
import { verifyTurnstile } from "../lib/turnstile";

const RETENTION_SAMPLE_RATE = 1 / 50;

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) =>
  handleErrorReport(request, env, waitUntil);

export async function handleErrorReport(
  request: Request,
  env: Env,
  waitUntil: ExecutionContext["waitUntil"],
  random: () => number = Math.random,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  const parsed = await parseJsonBody(request, errorReportSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const data: ErrorReportRequest = parsed.data;
  if (!(await verifyTurnstile(data.turnstileToken, request, env))) {
    return turnstileFailedResponse();
  }

  await env.DB.prepare(
    "INSERT INTO error_reports (stage, error_name, message, meta_json) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(data.stage, data.errorName, data.message, serializeMeta(data.meta))
    .run();

  if (shouldRunRetentionCleanup(random)) {
    const cleanup = cleanupErrorReports(env.DB).catch((error: unknown) => {
      console.error("Error report retention cleanup failed", safeErrorDetails(error));
    });
    waitUntil(cleanup);
  }

  return jsonResponse({ ok: true }, 202, "no-store");
}

export function shouldRunRetentionCleanup(random: () => number = Math.random): boolean {
  return random() < RETENTION_SAMPLE_RATE;
}

export async function cleanupErrorReports(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM error_reports WHERE created_at < ?1").bind(retentionCutoffIso(now)).run();
}

function safeErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return "Unknown error";
}
