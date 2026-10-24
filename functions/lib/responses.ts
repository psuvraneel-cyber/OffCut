import type { ApiErrorCode } from "../../shared/api-types";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const DEFAULT_CACHE_CONTROL = "no-store";

export function withApiHeaders(response: Response, cacheControl?: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", cacheControl ?? DEFAULT_CACHE_CONTROL);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(
  body: unknown,
  status = 200,
  cacheControl = DEFAULT_CACHE_CONTROL,
  additionalHeaders?: HeadersInit,
): Response {
  const headers = new Headers(additionalHeaders);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");

  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  fields?: Record<string, string>,
  additionalHeaders?: HeadersInit,
): Response {
  return jsonResponse(
    {
      ok: false,
      error: fields ? { code, message, fields } : { code, message },
    },
    status,
    DEFAULT_CACHE_CONTROL,
    additionalHeaders,
  );
}

export function okResponse(status = 200, cacheControl = DEFAULT_CACHE_CONTROL): Response {
  return jsonResponse({ ok: true }, status, cacheControl);
}

export function methodNotAllowed(allow: string): Response {
  return errorResponse(
    "METHOD_NOT_ALLOWED",
    "Method not allowed.",
    405,
    undefined,
    { Allow: allow },
  );
}

export function notFoundResponse(): Response {
  return errorResponse("NOT_FOUND", "Not found.", 404);
}

export function validationError(message: string, fields?: Record<string, string>): Response {
  return errorResponse("VALIDATION_ERROR", message, 400, fields);
}

export function turnstileFailedResponse(): Response {
  return errorResponse("TURNSTILE_FAILED", "Bot verification failed.", 403);
}

export function forbiddenOriginResponse(): Response {
  return errorResponse("FORBIDDEN_ORIGIN", "Origin is not allowed.", 403);
}

export function internalErrorResponse(): Response {
  return errorResponse("INTERNAL", "An internal error occurred.", 500);
}
