# Backend build prompt

Copy everything below the line into your backend AI tool. The "API contract" section is the source of truth for both the backend and the frontend, so if anything in it changes, update this file first.

---

## Role and goal

You are a senior backend engineer. Build the complete backend for a website called **Offcut** (internal codename: `clipper`). Work in TypeScript, keep the code simple and readable, and do not add anything that is not asked for below.

### What the product is (read this first, it shapes every decision)

Offcut is a **free, open-source, in-browser AI video clipping tool**. A creator drops a long video into the web page and gets back short, captioned, vertical clips (Reels/Shorts). **All video and AI processing happens on the user's own device**, in the browser (Whisper speech-to-text via Transformers.js/WebGPU, face tracking, WebCodecs encoding). The AI model files load from Hugging Face's CDN.

This means:

- **The backend never receives, stores, or processes video, audio, images, or transcripts. Ever.** "Your video never leaves your computer" is the product's main promise. Do not add any endpoint that accepts media or transcript text.
- The backend is small. It only powers the website's community features: an early-access waitlist, a feedback form, a public feature-voting board, a public "clips made" counter, and opt-in anonymous error reports.
- The budget is **zero**. Everything must run on **Cloudflare's free plan**.

## Tech stack (fixed, do not substitute)

- **Cloudflare Pages Functions** (file-based routing in `/functions`), TypeScript.
- **Cloudflare D1** (SQLite) for storage, accessed through a binding named `DB`.
- **Cloudflare Turnstile** (free CAPTCHA alternative) to protect every write endpoint from bots.
- **Zod** for request validation (the only runtime dependency allowed besides Cloudflare's own types).
- **Wrangler** for local development, migrations and deployment.
- **Vitest** with `@cloudflare/vitest-pool-workers` for tests.

Do not use Express, Hono, Prisma, an ORM, KV, R2, Durable Objects, Queues, external databases, or any paid service.

### Free-plan budget (stay far below these)

Check Cloudflare's docs for current numbers. As of 2026 they are roughly: Workers/Functions ~100,000 requests per day and **10 ms CPU time per request**; D1 ~5 million rows read and ~100,000 rows written per day, 5 GB storage. Design accordingly:

- One SQL query per read endpoint where possible (no N+1 queries).
- Cache public GET responses (`Cache-Control: public, max-age=60`).
- Keep request bodies small (reject bodies over 10 KB with 413).
- No heavy CPU work (no hashing loops, no big JSON transforms).

## Repository layout

The repo is shared with a frontend that another engineer is building at the same time. Only touch the paths marked "yours".

```
/                         repo root
├── web/                  frontend (NOT yours, don't edit; builds to web/dist)
├── functions/            yours: Pages Functions
│   ├── api/
│   │   ├── health.ts
│   │   ├── waitlist/index.ts
│   │   ├── waitlist/remove.ts
│   │   ├── feedback.ts
│   │   ├── features/index.ts
│   │   ├── features/[id]/vote.ts
│   │   ├── stats/index.ts
│   │   ├── stats/export.ts
│   │   ├── errors.ts
│   │   └── _middleware.ts  yours: shared middleware for /api/* (must live in api/, see Middleware)
│   └── lib/              yours: helpers (validation, turnstile, responses, db)
├── shared/
│   └── api-types.ts      yours: create it exactly from the contract below
├── migrations/           yours: D1 SQL migrations
├── test/                 yours: backend tests
├── wrangler.toml         yours
├── package.json          shared: add only backend scripts/deps
└── docs/backend.md       yours: backend README
```

`wrangler.toml` must set `name = "offcut"` (the Pages project, so the site lives at `https://offcut.pages.dev`), `pages_build_output_dir = "web/dist"`, and declare the D1 binding `DB` (database name `clipper-db`). Top-level `[vars]` are for local dev and previews (localhost origins). Production needs its own `[env.production.vars]` **and** `[[env.production.d1_databases]]` (bindings aren't inherited), with `APP_ENV = "production"` and the production origin(s) in `ALLOWED_ORIGINS`. If `web/dist` doesn't exist yet, create an empty `web/dist/index.html` placeholder for local dev only and say so in the README.

To build the frontend locally, use `npm run build:web`. Never run the root `npm run build` locally: it runs `npm ci` in `web/`, which deletes `web/node_modules` (it's meant for Cloudflare's build servers).

## Configuration

| Name | Kind | Purpose |
|---|---|---|
| `DB` | D1 binding | The database |
| `TURNSTILE_SECRET_KEY` | Secret | Server-side Turnstile verification. Never commit it. |
| `ALLOWED_ORIGINS` | Var | Comma-separated origins allowed to call write endpoints, e.g. `https://offcut.pages.dev` in production, `http://localhost:5173,http://localhost:8788` locally |
| `APP_ENV` | Var | `development` or `production` |

For local development, use **Cloudflare's published Turnstile test keys** (the "always passes" secret) in `.dev.vars`, and commit a `.dev.vars.example` with placeholder values instead. Add `.dev.vars` to `.gitignore`.

## API contract (source of truth: implement exactly)

All endpoints live under `/api`, are same-origin with the frontend, and return JSON.

### Shared types: put these verbatim in `shared/api-types.ts`

```ts
export type ApiErrorCode =
  | "VALIDATION_ERROR"   // 400: bad or missing fields
  | "TURNSTILE_FAILED"   // 403: bot check failed or missing
  | "FORBIDDEN_ORIGIN"   // 403: Origin not in ALLOWED_ORIGINS
  | "NOT_FOUND"          // 404
  | "METHOD_NOT_ALLOWED" // 405: response includes an Allow header
  | "CONFLICT"           // 409
  | "PAYLOAD_TOO_LARGE"  // 413
  | "RATE_LIMITED"       // 429
  | "INTERNAL";          // 500

export interface ApiError {
  ok: false;
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> };
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

// GET /api/health
export interface HealthResponse { version: string; time: string }

// POST /api/waitlist
export interface WaitlistRequest {
  email: string;               // trimmed, lowercased, max 254 chars, valid email
  consent: true;               // must be literally true
  source?: string;             // optional, max 50 chars, e.g. "instagram", "hero"
  turnstileToken: string;
}
export interface WaitlistResponse { alreadyJoined: boolean }

// POST /api/waitlist/remove
export interface WaitlistRemoveRequest { email: string; turnstileToken: string }
export type WaitlistRemoveResponse = Record<string, never>; // always { ok: true }

// POST /api/feedback
export type FeedbackCategory = "bug" | "idea" | "other";
export interface FeedbackRequest {
  category: FeedbackCategory;
  message: string;             // 5..2000 chars after trimming
  contact?: string;            // optional email, max 254
  meta?: ClientMeta;
  turnstileToken: string;
}
export interface FeedbackResponse { id: number }

// GET /api/features
export type FeatureStatus = "idea" | "planned" | "building" | "shipped";
export interface Feature {
  id: string;                  // slug, e.g. "hindi-captions"
  title: string;
  description: string;
  status: FeatureStatus;
  votes: number;
}
export interface FeaturesResponse { features: Feature[] } // sorted: status order, then votes desc

// POST /api/features/:id/vote   (vote)
// DELETE /api/features/:id/vote (remove vote)
export interface VoteRequest {
  voterId: string;             // random UUID v4 the browser generates and keeps in localStorage
  turnstileToken: string;
}
export interface VoteResponse { featureId: string; votes: number; voted: boolean }

// GET /api/stats
export interface StatsResponse {
  clipsExported: number;
  minutesProcessed: number;
  updatedAt: string;           // ISO 8601
}

// POST /api/stats/export
export interface ExportStatRequest {
  clips: number;               // integer 1..20
  sourceMinutes: number;       // number 0..600, rounded to 1 decimal on save
  turnstileToken: string;
}
export type ExportStatResponse = Record<string, never>;

// POST /api/errors  (opt-in, anonymous crash reports)
export type PipelineStage =
  | "load" | "demux" | "transcribe" | "pick" | "reframe" | "captions" | "encode" | "download" | "other";
export interface ErrorReportRequest {
  stage: PipelineStage;
  errorName: string;           // max 100 chars
  message: string;             // max 500 chars, truncate instead of rejecting
  meta?: ClientMeta;
  turnstileToken: string;
}
export type ErrorReportResponse = Record<string, never>;

export interface ClientMeta {
  appVersion?: string;         // max 20 chars
  browser?: string;            // max 100 chars, e.g. "Chrome 155"
  os?: string;                 // max 50 chars
  webgpu?: boolean;
  crossOriginIsolated?: boolean;
}
```

### Endpoint rules

| Method & path | Turnstile | Cache | Success status | Notes |
|---|---|---|---|---|
| `GET /api/health` | no | `no-store` | 200 | `version` comes from package.json |
| `POST /api/waitlist` | yes | `no-store` | 201 new, 200 already joined | Duplicate email is **not** an error: return `{ ok: true, alreadyJoined: true }` |
| `POST /api/waitlist/remove` | yes | `no-store` | 200 | Always `{ ok: true }`, even if the email wasn't there (don't reveal who signed up) |
| `POST /api/feedback` | yes | `no-store` | 201 | |
| `GET /api/features` | no | `public, max-age=60` | 200 | One query with a LEFT JOIN + COUNT |
| `POST /api/features/:id/vote` | yes | `no-store` | 200 | Idempotent: voting twice keeps one vote. 404 if the feature doesn't exist. Shipped features can't be voted on (409). |
| `DELETE /api/features/:id/vote` | yes | `no-store` | 200 | Idempotent |
| `GET /api/stats` | no | `public, max-age=60` | 200 | |
| `POST /api/stats/export` | yes | `no-store` | 202 | Atomic increments |
| `POST /api/errors` | yes | `no-store` | 202 | |

Unknown `/api/*` routes return 404 with `NOT_FOUND`. Wrong methods return 405 `METHOD_NOT_ALLOWED` with an `Allow` header.

## Middleware (`functions/api/_middleware.ts`, applies to `/api/*` only)

It must live in `functions/api/`, not at the root of `functions/`. A root-level middleware makes Cloudflare route **every** request (pages, scripts, fonts) through Functions, burning the free daily request quota on static files.

1. **Origin check.** For every non-GET request, the `Origin` header must be present and listed in `ALLOWED_ORIGINS`, otherwise 403 `FORBIDDEN_ORIGIN`. No CORS headers are needed (same-origin). Don't add `Access-Control-Allow-Origin: *`.
2. **Body limits.** Reject non-JSON content types on POST/DELETE with 400 and bodies over 10 KB with 413.
3. **Response headers** on every API response: `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and the endpoint's `Cache-Control`.
4. **Error handling.** Catch everything. Unexpected errors return 500 `INTERNAL` with a generic message; log details with `console.error` but never log emails, feedback text, or tokens.
5. **Do not set** `Cross-Origin-Embedder-Policy` or `Cross-Origin-Opener-Policy`. The frontend owns those decisions because they would block the site's ads.

## Turnstile

Write `lib/turnstile.ts` with `verifyTurnstile(token, request, env): Promise<boolean>` that POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the secret, the token, and the `CF-Connecting-IP` header as `remoteip`. Treat a network failure as a failed check. Missing or failed token → 403 `TURNSTILE_FAILED`. Verify Turnstile **before** any database write.

## Database (D1)

Create `migrations/0001_init.sql`:

```sql
CREATE TABLE waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  source      TEXT,
  consent_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL CHECK (category IN ('bug','idea','other')),
  message     TEXT    NOT NULL,
  contact     TEXT,
  meta_json   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE features (
  id          TEXT    PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('idea','planned','building','shipped')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feature_votes (
  feature_id  TEXT    NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  voter_id    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (feature_id, voter_id)
);

CREATE TABLE stats (
  key         TEXT    PRIMARY KEY,
  value       REAL    NOT NULL DEFAULT 0,
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE error_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage       TEXT    NOT NULL,
  error_name  TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  meta_json   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_error_reports_created ON error_reports(created_at);

INSERT INTO stats (key, value) VALUES ('clips_exported', 0), ('minutes_processed', 0);
```

Create `migrations/0002_seed_features.sql` with these starter features (status `idea` unless noted; `sort_order` in this order):

1. `hindi-captions`: "Hindi & Hinglish captions": "Accurate captions for Hindi and Hinglish speech."
2. `caption-styles`: "More caption styles": "New fonts, colours, emoji and animation presets."
3. `batch-export`: "Export all clips at once": "Render every selected clip in one go."
4. `auto-broll`: "Auto B-roll suggestions": "Suggest cut-aways and zooms to keep viewers watching."
5. `desktop-app`: "Desktop app": "A faster installable app for long podcasts." (status `planned`)

Rules:
- Use prepared statements with bound parameters everywhere. No string-built SQL.
- Stats increments must be atomic single statements (`UPDATE stats SET value = value + ?1, updated_at = ... WHERE key = ?2`), batched with `DB.batch()`.
- **Data retention:** delete `error_reports` older than 90 days. Pages Functions have no cron, so on roughly 1 in 50 successful `POST /api/errors` calls, also run `DELETE FROM error_reports WHERE created_at < ?` (90 days ago). Make the 1-in-50 chance injectable so it's testable.

## Privacy rules (non-negotiable)

- Never store IP addresses, user agents, or cookies. Never set cookies.
- `voterId` must match a UUID v4 pattern. It's a random ID the browser makes, not personal data.
- Emails are stored only when `consent === true`, and are removable via `/api/waitlist/remove`.
- No analytics, tracking, fingerprinting, or third-party calls other than Turnstile verification.
- The backend never sends email.

## Validation details

- Use Zod schemas in `lib/schemas.ts`, derived from the shared types.
- Trim all strings. Lowercase emails. Reject control characters in titles/messages except newlines in `message`.
- On validation failure, return 400 `VALIDATION_ERROR` with `fields` mapping each bad field to a short human-readable reason.
- `:id` route params must match `^[a-z0-9-]{1,50}$`, else 404.

## Tests (must pass with `npm run test:api`)

Cover at least:
- Health returns 200 with a version.
- Waitlist: new signup 201; duplicate (different casing) 200 with `alreadyJoined: true`; missing consent 400; bad email 400; failed Turnstile 403; bad origin 403; oversized body 413.
- Waitlist remove: returns 200 whether or not the email exists, and actually removes it.
- Feedback: valid 201; too-short message 400.
- Features: sorted correctly with vote counts; vote is idempotent; unvote works; unknown feature 404; voting on a shipped feature 409; invalid voterId 400.
- Stats: export increments both counters atomically; out-of-range values 400; GET returns totals and the cache header.
- Errors: long message truncated to 500; retention cleanup deletes only rows older than 90 days.
- Unknown route 404; wrong method 405.

Mock Turnstile verification in tests (inject the verifier or stub `fetch`). Don't call the real Turnstile API.

## Scripts to add to package.json

- `dev:api`: run `wrangler pages dev` with the D1 binding (serving `web/dist`)
- `db:migrate:local` / `db:migrate:remote`: apply D1 migrations
- `test:api`: run the backend tests
- `typecheck:api`: `tsc --noEmit` for `functions/`, `shared/`, `test/`

## Out of scope (do NOT build)

User accounts, login, sessions, JWTs, admin dashboards or admin endpoints (the owner uses `wrangler d1 execute` directly), media/transcript upload, email sending, payments, ads logic (the frontend handles ads), analytics, WebSockets, cron Workers, Docker, any other cloud provider.

## Deliverables and done criteria

1. All files listed in "Repository layout" (yours only).
2. `docs/backend.md` explaining, step by step for a beginner on Windows:
   - installing dependencies
   - creating the D1 database (`npx wrangler d1 create clipper-db`) and pasting its ID into `wrangler.toml`
   - running migrations locally and remotely
   - setting the Turnstile secret (`npx wrangler pages secret put TURNSTILE_SECRET_KEY`)
   - running locally and running tests
   - deploying with Cloudflare Pages
   - useful `wrangler d1 execute` commands to view or export waitlist, feedback, votes and error reports
3. `npm run typecheck:api` and `npm run test:api` both pass.
4. No secrets committed. `.dev.vars.example` is present.
5. At the end, reply with: a file list, how to run it, and **any place you deviated from this spec and why**. Don't silently change the contract. If something in the spec is impossible, say so instead of improvising.
