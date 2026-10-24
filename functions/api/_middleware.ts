import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../lib/env";
import {
  errorResponse,
  forbiddenOriginResponse,
  internalErrorResponse,
  validationError,
  withApiHeaders,
} from "../lib/responses";

const MAX_BODY_BYTES = 10 * 1024;

// Lives in functions/api/ (not functions/) so Cloudflare only runs Functions for /api/* requests;
// a root-level middleware would make every page, script and font request invoke a Function.
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;

  try {
    if (request.method !== "GET" && !isAllowedOrigin(request, context.env)) {
      return forbiddenOriginResponse();
    }

    if (request.method === "POST" || request.method === "DELETE") {
      const contentType = request.headers.get("Content-Type");
      if (!contentType || contentType.toLowerCase().split(";", 1)[0].trim() !== "application/json") {
        return validationError("Request body must use application/json.", {
          contentType: "must be application/json",
        });
      }

      const contentLength = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
        return errorResponse("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
      }

      const body = await request.clone().arrayBuffer();
      if (body.byteLength > MAX_BODY_BYTES) {
        return errorResponse("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
      }
    }

    const response = await context.next();
    return withApiHeaders(response);
  } catch (error) {
    console.error("API request failed", safeErrorDetails(error));
    return internalErrorResponse();
  }
};

function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) {
    return false;
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return allowedOrigins.includes(origin);
}

function safeErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return "Unknown error";
}
