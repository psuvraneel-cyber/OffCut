import type { PagesFunction } from "@cloudflare/workers-types";
import type { WaitlistRemoveRequest } from "../../../shared/api-types";
import type { Env } from "../../lib/env";
import { parseJsonBody } from "../../lib/body";
import { methodNotAllowed, okResponse, turnstileFailedResponse } from "../../lib/responses";
import { waitlistRemoveSchema } from "../../lib/schemas";
import { verifyTurnstile } from "../../lib/turnstile";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  const parsed = await parseJsonBody(request, waitlistRemoveSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const data: WaitlistRemoveRequest = parsed.data;
  if (!(await verifyTurnstile(data.turnstileToken, request, env))) {
    return turnstileFailedResponse();
  }

  await env.DB.prepare("DELETE FROM waitlist WHERE email = ?1").bind(data.email).run();
  return okResponse(200, "no-store");
};
