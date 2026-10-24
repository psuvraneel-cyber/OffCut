import type { PagesFunction } from "@cloudflare/workers-types";
import type { FeatureStatus, VoteRequest, VoteResponse } from "../../../../shared/api-types";
import type { Env } from "../../../lib/env";
import { parseJsonBody } from "../../../lib/body";
import { jsonResponse, methodNotAllowed, notFoundResponse, turnstileFailedResponse } from "../../../lib/responses";
import { isFeatureId, voteSchema } from "../../../lib/schemas";
import { verifyTurnstile } from "../../../lib/turnstile";

interface FeatureStatusRow {
  status: FeatureStatus;
}

interface VoteCountRow {
  votes: number;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const featureId = context.params.id;
  if (typeof featureId !== "string" || !isFeatureId(featureId)) {
    return notFoundResponse();
  }

  if (context.request.method !== "POST" && context.request.method !== "DELETE") {
    return methodNotAllowed("POST, DELETE");
  }

  const parsed = await parseJsonBody(context.request, voteSchema);
  if ("response" in parsed) {
    return parsed.response;
  }

  const data: VoteRequest = parsed.data;
  if (!(await verifyTurnstile(data.turnstileToken, context.request, context.env))) {
    return turnstileFailedResponse();
  }

  const feature = await context.env.DB.prepare("SELECT status FROM features WHERE id = ?1")
    .bind(featureId)
    .first<FeatureStatusRow>();
  if (!feature) {
    return notFoundResponse();
  }

  if (context.request.method === "POST" && feature.status === "shipped") {
    return jsonResponse(
      {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Shipped features cannot be voted on.",
        },
      },
      409,
      "no-store",
    );
  }

  if (context.request.method === "POST") {
    await context.env.DB.prepare(
      "INSERT OR IGNORE INTO feature_votes (feature_id, voter_id) VALUES (?1, ?2)",
    )
      .bind(featureId, data.voterId)
      .run();
  } else {
    await context.env.DB.prepare(
      "DELETE FROM feature_votes WHERE feature_id = ?1 AND voter_id = ?2",
    )
      .bind(featureId, data.voterId)
      .run();
  }

  const count = await context.env.DB.prepare(
    "SELECT COUNT(*) AS votes FROM feature_votes WHERE feature_id = ?1",
  )
    .bind(featureId)
    .first<VoteCountRow>();

  const response: { ok: true } & VoteResponse = {
    ok: true,
    featureId,
    votes: Number(count?.votes ?? 0),
    voted: context.request.method === "POST",
  };
  return jsonResponse(response, 200, "no-store");
};
