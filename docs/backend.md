# Offcut backend

This folder contains the small Cloudflare Pages Functions backend for Offcut (internal codename: clipper). It never accepts video, audio, images, or transcript text. The browser does the clipping and AI work locally; these functions only store community data in D1.

## What is included

- Cloudflare Pages Functions in `functions/`
- Cloudflare D1 migrations in `migrations/`
- Shared frontend/backend API types in `shared/api-types.ts`
- Vitest integration tests in `test/`
- Zod request validation and Cloudflare Turnstile verification

The public GET endpoints are cached for 60 seconds. Write endpoints require an allowed `Origin`, JSON bodies no larger than 10 KB, and a successful Turnstile check. IP addresses, user agents, cookies, video, audio, images, and transcripts are never stored.

## Prerequisites on Windows

Install Node.js 20 or newer and make sure `node` and `npm` work in PowerShell:

```powershell
node --version
npm --version
```

You also need a Cloudflare account for remote D1 and Pages deployment. The local tests do not need a Cloudflare login.

## 1. Install dependencies

From the repository root:

```powershell
npm install
```

The root package contains the backend dependencies. The existing frontend remains in `web/` and keeps its own `web/package-lock.json`.

For local Pages development, the repository includes an ignored `.dev.vars` using Cloudflare's published Turnstile test secret that always passes. To recreate it on another machine:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Replace the placeholder in `.dev.vars` with the published local Turnstile test secret. Never commit `.dev.vars` or a production secret.

## 2. Create the D1 database

Log in once:

```powershell
npx wrangler login
```

Create the database:

```powershell
npx wrangler d1 create clipper-db
```

Wrangler prints a `database_id`. Open `wrangler.toml` and replace the placeholder value of `database_id` under `[[d1_databases]]` with that ID. Keep the binding name exactly `DB` and the database name exactly `clipper-db`.

The placeholder ID is intentional so the repository can be cloned and tested locally without committing a real Cloudflare resource ID.

## 3. Apply migrations

Apply both migrations to the local D1 database:

```powershell
npm run db:migrate:local
```

Apply them to the remote database after replacing the ID in `wrangler.toml`:

```powershell
npm run db:migrate:remote
```

The second migration seeds the five public feature-board items. Migrations are recorded by Wrangler/D1, so rerunning the command does not apply them twice.

## 4. Configure Turnstile

Local development uses the published Cloudflare test secret from `.dev.vars`. For the deployed Pages project, set the secret without putting it in `wrangler.toml`:

```powershell
npx wrangler pages secret put TURNSTILE_SECRET_KEY
```

When prompted, paste the production Turnstile secret. `ALLOWED_ORIGINS` and `APP_ENV` are non-secret variables in `wrangler.toml`. The top-level `[vars]` (localhost origins) are used for local development and preview deployments; `[env.production.vars]` holds the live origin (`https://offcut.pages.dev`). If Cloudflare gives your project a different `pages.dev` address, or you add a custom domain, update the production `ALLOWED_ORIGINS` to match.

## 5. Run the checks

Run the backend typecheck:

```powershell
npm run typecheck:api
```

Run the D1-backed API tests:

```powershell
npm run test:api
```

The test runner uses `@cloudflare/vitest-pool-workers`, an in-memory Workers runtime, and the real D1 migration files. Turnstile is stubbed in the tests; no request is sent to Cloudflare's Turnstile service.

## 6. Run locally

The Pages dev server serves `web/dist`. The repository includes an empty `web/dist/index.html` placeholder so the API can start before the frontend is built. For a real local page, build the frontend first:

```powershell
npm run build:web
npm run dev:api
```

Use `build:web` locally, not the root `npm run build`. The root `build` script runs `npm ci` inside `web/` (it is meant for Cloudflare's build servers), which deletes `web/node_modules` and fails on Windows if the Vite dev server is running.

Open `http://localhost:8788/api/health` to check the API. The local allowed origins include `http://localhost:8788` and `http://localhost:5173`.

If you only want the Vite frontend, use the existing command in a separate terminal:

```powershell
npm run dev:web
```

## 7. Deploy with Cloudflare Pages

Create a Pages project once if needed:

```powershell
npx wrangler pages project create offcut
```

Build the frontend and deploy the Pages output plus the `functions/` directory:

```powershell
npm run build:web
npx wrangler pages deploy web/dist --project-name offcut
```

After deployment, set the production `TURNSTILE_SECRET_KEY`, check that the production `ALLOWED_ORIGINS` in `wrangler.toml` matches the address Cloudflare gave the project, and apply the remote D1 migrations if you have not already done so.

## Useful D1 commands

Use `--local` while developing and `--remote` for the deployed database. The `--json` flag makes output easy to save in PowerShell; treat exported data as private.

View the waitlist:

```powershell
npx wrangler d1 execute clipper-db --remote --command "SELECT id, email, source, consent_at, created_at FROM waitlist ORDER BY created_at DESC" --json > waitlist.json
```

View feedback:

```powershell
npx wrangler d1 execute clipper-db --remote --command "SELECT id, category, message, contact, meta_json, created_at FROM feedback ORDER BY created_at DESC" --json > feedback.json
```

View vote totals and individual votes:

```powershell
npx wrangler d1 execute clipper-db --remote --command "SELECT feature_id, COUNT(*) AS votes FROM feature_votes GROUP BY feature_id ORDER BY votes DESC" --json > vote-totals.json
npx wrangler d1 execute clipper-db --remote --command "SELECT feature_id, voter_id, created_at FROM feature_votes ORDER BY created_at DESC" --json > votes.json
```

View anonymous error reports:

```powershell
npx wrangler d1 execute clipper-db --remote --command "SELECT id, stage, error_name, message, meta_json, created_at FROM error_reports ORDER BY created_at DESC" --json > error-reports.json
```

For local data, change `--remote` to `--local`. To inspect migration state:

```powershell
npx wrangler d1 execute clipper-db --remote --command "SELECT * FROM d1_migrations ORDER BY id"
```

## Configuration reference

| Name | Where | Purpose |
| --- | --- | --- |
| `DB` | `wrangler.toml` D1 binding | D1 storage |
| `TURNSTILE_SECRET_KEY` | `.dev.vars` locally / Pages secret remotely | Server-side Turnstile verification |
| `ALLOWED_ORIGINS` | `wrangler.toml` (`[vars]` locally, `[env.production.vars]` live) | Exact origins permitted for writes |
| `APP_ENV` | `wrangler.toml` (`[vars]` locally, `[env.production.vars]` live) | `development` or `production` |

The API middleware lives in `functions/api/_middleware.ts` so Cloudflare only runs Functions for `/api/*`; the rest of the site is served as free static files.

The backend uses one query for each public read where practical, atomic `DB.batch()` updates for export statistics, and sampled 90-day cleanup for error reports. As checked on October 24, 2026, Cloudflare documents 100,000 Workers Free requests per day and 10 ms CPU time per HTTP request. D1 Free includes 5 million rows read/day, 100,000 rows written/day, 500 MB per database, and 5 GB total account storage. These numbers can change, so confirm the current Workers limits and D1 pricing/limits before launch.
