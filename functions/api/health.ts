import type { PagesFunction } from "@cloudflare/workers-types";
import packageJson from "../../package.json";
import type { HealthResponse } from "../../shared/api-types";
import type { Env } from "../lib/env";
import { jsonResponse, methodNotAllowed } from "../lib/responses";

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method !== "GET") {
    return methodNotAllowed("GET");
  }

  const response: { ok: true } & HealthResponse = {
    ok: true,
    version: packageJson.version,
    time: new Date().toISOString(),
  };

  return jsonResponse(response, 200, "no-store");
};
