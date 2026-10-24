import type { PagesFunction } from "@cloudflare/workers-types";
import type { FeaturesResponse } from "../../../shared/api-types";
import type { Env } from "../../lib/env";
import { toFeature, type FeatureRow } from "../../lib/db";
import { jsonResponse, methodNotAllowed } from "../../lib/responses";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET") {
    return methodNotAllowed("GET");
  }

  const result = await env.DB.prepare(
    `SELECT
       f.id,
       f.title,
       f.description,
       f.status,
       COUNT(v.feature_id) AS votes
     FROM features AS f
     LEFT JOIN feature_votes AS v ON v.feature_id = f.id
     GROUP BY f.id, f.title, f.description, f.status, f.sort_order
     ORDER BY
       CASE f.status
         WHEN 'idea' THEN 0
         WHEN 'planned' THEN 1
         WHEN 'building' THEN 2
         WHEN 'shipped' THEN 3
       END,
       votes DESC,
       f.sort_order ASC,
       f.id ASC`,
  )
    .bind()
    .all<FeatureRow>();

  const response: { ok: true } & FeaturesResponse = {
    ok: true,
    features: result.results.map(toFeature),
  };
  return jsonResponse(response, 200, "public, max-age=60");
};
