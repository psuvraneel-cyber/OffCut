export interface Env {
  DB: D1Database;
  ASSETS: {
    fetch: typeof fetch;
  };
  TURNSTILE_SECRET_KEY?: string;
  ALLOWED_ORIGINS?: string;
  APP_ENV?: string;
}
