import type { PagesFunction } from "@cloudflare/workers-types";
import type { StatsResponse } from "../../../shared/api-types";
import type { Env } from "../../lib/env";
import { jsonResponse, methodNotAllowed } from "../../lib/responses";

interface StatRow {
  key: string;
  value: number;
  updated_at: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET") {
    return methodNotAllowed("GET");
  }

  const result = await env.DB.prepare(
    "SELECT key, value, updated_at FROM stats WHERE key IN (?1, ?2)",
  )
    .bind("clips_exported", "minutes_processed")
    .all<StatRow>();

  const values = new Map(result.results.map((row) => [row.key, row]));
  const updatedAt = result.results.reduce(
    (latest, row) => (row.updated_at > latest ? row.updated_at : latest),
    new Date(0).toISOString(),
  );
  const response: { ok: true } & StatsResponse = {
    ok: true,
    clipsExported: Number(values.get("clips_exported")?.value ?? 0),
    minutesProcessed: Number(values.get("minutes_processed")?.value ?? 0),
    updatedAt,
  };
  return jsonResponse(response, 200, "public, max-age=60");
};
