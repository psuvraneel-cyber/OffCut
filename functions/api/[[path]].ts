import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../lib/env";
import { notFoundResponse } from "../lib/responses";

export const onRequest: PagesFunction<Env> = async () => notFoundResponse();
