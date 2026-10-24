import type { PagesFunction } from "@cloudflare/workers-types";
import type { WaitlistRequest, WaitlistResponse } from "../../../shared/api-types";
import type { Env } from "../../lib/env";
import { parseJsonBody } from "../../lib/body";
import { jsonResponse, methodNotAllowed, turnstileFailedResponse } from "../../lib/responses";
import { waitlistSchema } from "../../lib/schemas";
import { verifyTurnstile } from "../../lib/turnstile";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  const parsed = await parseJsonBody(request, waitlistSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const data: WaitlistRequest = parsed.data;
  if (!(await verifyTurnstile(data.turnstileToken, request, env))) {
    return turnstileFailedResponse();
  }

  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO waitlist (email, source, consent_at) VALUES (?1, ?2, ?3)",
  )
    .bind(data.email, data.source ?? null, new Date().toISOString())
    .run();

  const alreadyJoined = result.meta.changes === 0;
  const response: { ok: true } & WaitlistResponse = { ok: true, alreadyJoined };
  return jsonResponse(response, alreadyJoined ? 200 : 201, "no-store");
};
