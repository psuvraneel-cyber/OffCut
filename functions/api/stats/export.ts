import type { PagesFunction } from "@cloudflare/workers-types";
import type { ExportStatRequest } from "../../../shared/api-types";
import type { Env } from "../../lib/env";
import { parseJsonBody } from "../../lib/body";
import { jsonResponse, methodNotAllowed, turnstileFailedResponse } from "../../lib/responses";
import { exportStatSchema } from "../../lib/schemas";
import { verifyTurnstile } from "../../lib/turnstile";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  const parsed = await parseJsonBody(request, exportStatSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const data: ExportStatRequest = parsed.data;
  if (!(await verifyTurnstile(data.turnstileToken, request, env))) {
    return turnstileFailedResponse();
  }

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE stats SET value = value + ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ?2",
    ).bind(data.clips, "clips_exported"),
    env.DB.prepare(
      "UPDATE stats SET value = value + ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ?2",
    ).bind(data.sourceMinutes, "minutes_processed"),
  ]);

  return jsonResponse({ ok: true }, 202, "no-store");
};
