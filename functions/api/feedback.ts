import type { PagesFunction } from "@cloudflare/workers-types";
import type { FeedbackRequest, FeedbackResponse } from "../../shared/api-types";
import type { Env } from "../lib/env";
import { parseJsonBody } from "../lib/body";
import { serializeMeta } from "../lib/db";
import { jsonResponse, methodNotAllowed, turnstileFailedResponse } from "../lib/responses";
import { feedbackSchema } from "../lib/schemas";
import { verifyTurnstile } from "../lib/turnstile";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  const parsed = await parseJsonBody(request, feedbackSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const data: FeedbackRequest = parsed.data;
  if (!(await verifyTurnstile(data.turnstileToken, request, env))) {
    return turnstileFailedResponse();
  }

  const result = await env.DB.prepare(
    "INSERT INTO feedback (category, message, contact, meta_json) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(data.category, data.message, data.contact ?? null, serializeMeta(data.meta))
    .run();

  const id = Number(result.meta.last_row_id);
  const response: { ok: true } & FeedbackResponse = { ok: true, id };
  return jsonResponse(response, 201, "no-store");
};
