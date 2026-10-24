import type { ExecutionContext, PagesFunction } from "@cloudflare/workers-types";
import { onRequest as apiMiddleware } from "../functions/api/_middleware";
import { onRequest as errorReport } from "../functions/api/errors";
import { onRequest as featureList } from "../functions/api/features/index";
import { onRequest as featureVote } from "../functions/api/features/[id]/vote";
import { onRequest as feedback } from "../functions/api/feedback";
import { onRequest as health } from "../functions/api/health";
import { onRequest as stats } from "../functions/api/stats/index";
import { onRequest as statsExport } from "../functions/api/stats/export";
import { onRequest as waitlist } from "../functions/api/waitlist/index";
import { onRequest as waitlistRemove } from "../functions/api/waitlist/remove";
import type { Env } from "../functions/lib/env";
import { notFoundResponse } from "../functions/lib/responses";

type PagesContext = Parameters<PagesFunction<Env>>[0];

export default {
  fetch(request: Request, env: Env, executionContext: ExecutionContext): Promise<Response> {
    return runRequest(request, env, executionContext);
  },
};

async function runRequest(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
): Promise<Response> {
  const context = createContext(request, env, executionContext);
  return apiMiddleware(context);
}

function createContext(
  request: Request,
  env: Env,
  executionContext: ExecutionContext,
): PagesContext {
  let context: PagesContext;
  context = {
    request: request as PagesContext["request"],
    env,
    params: routeParams(request),
    data: {},
    functionPath: new URL(request.url).pathname,
    waitUntil: executionContext.waitUntil.bind(executionContext),
    passThroughOnException: executionContext.passThroughOnException.bind(executionContext),
    next: (): Promise<Response> => dispatch(context),
  };

  return context;
}

async function dispatch(context: PagesContext): Promise<Response> {
  const pathname = normalizePathname(new URL(context.request.url).pathname);

  if (pathname === "/api/health") {
    return health(context);
  }
  if (pathname === "/api/waitlist") {
    return waitlist(context);
  }
  if (pathname === "/api/waitlist/remove") {
    return waitlistRemove(context);
  }
  if (pathname === "/api/feedback") {
    return feedback(context);
  }
  if (pathname === "/api/features") {
    return featureList(context);
  }
  if (pathname === "/api/stats") {
    return stats(context);
  }
  if (pathname === "/api/stats/export") {
    return statsExport(context);
  }
  if (pathname === "/api/errors") {
    return errorReport(context);
  }

  const featureMatch = /^\/api\/features\/([^/]+)\/vote$/.exec(pathname);
  if (featureMatch) {
    return featureVote({ ...context, params: { id: featureMatch[1] } });
  }

  return notFoundResponse();
}

function routeParams(request: Request): Record<string, string> {
  const match = /^\/api\/features\/([^/]+)\/vote\/?$/.exec(new URL(request.url).pathname);
  return match ? { id: match[1] } : {};
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}
