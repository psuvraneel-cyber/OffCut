# Launching offcut-ai.pages.dev

The production checklist for the marketing site and its small backend (Cloudflare Pages + Functions + D1 + Turnstile, all on the free tier). Work top to bottom. Steps marked **owner** need the owner's own accounts and can't be done for them.

_Last checked: 2026-10-25 (wrangler 4.152.0, logged in as the owner, account has no Pages project and no D1 database yet)._

## 0. Already done and checked

- [x] `npm --prefix web run build` and `npm --prefix web run lint` pass.
- [x] `npm run typecheck:api` passes (the root now declares `@types/node`).
- [x] `npm run test:api` passes: 12 of 12 tests.
- [x] `npx wrangler pages functions build` compiles the Functions.
- [x] `wrangler.toml` is valid: `pages_build_output_dir = "web/dist"`, the `DB` binding to `clipper-db` at the top level and again under `[env.production]`, production `ALLOWED_ORIGINS = "https://offcut-ai.pages.dev"`.
- [x] `web/public/_headers` has security headers and **no** COOP/COEP (they would block ads later).
- [x] Head tags, share image (`og.png`), icons, web manifest, branded `404.html`.
- [x] Keyboard, focus and contrast pass at 1280×800 and 375×812.

## 1. Fill in the blanks (owner, no accounts needed)

- [x] `web/src/lib/site.ts`: `GITHUB_URL` and `INSTAGRAM_URL`. Linked to `https://github.com/psuvraneel-cyber/OffCut`.
- [x] `web/privacy.html` and `web/terms.html`: every blank filled in (name, contact email, city, reply time, liability cap, licence). "Draft" notice and `OWNER` comments removed.
- [x] Licence added: Apache License 2.0 with `LICENSE` and `NOTICE`.

## 2. Create the database (asks before running)

```powershell
npx wrangler d1 create clipper-db
```

Paste the printed `database_id` into **both** `database_id` lines in `wrangler.toml` (top level and `[env.production]`). Then create the tables and the five roadmap items:

```powershell
npm run db:migrate:remote
```

## 3. Create the Turnstile widget (owner, in the dashboard)

The wrangler login doesn't have the Turnstile scope, and the keys belong to the owner, so this one is by hand:

1. Open <https://dash.cloudflare.com> and sign in.
2. In the left sidebar, click **Turnstile** (it's under **Application security** on newer dashboards; if you can't see it, type "Turnstile" into the search box at the top).
3. Click **Add widget**.
4. **Widget name:** `Offcut`.
5. **Hostname management:** click **Add hostnames**, type `offcut-ai.pages.dev`, click **Add**, then select it so it's ticked. (Add a custom domain here too if you buy one later.)
6. **Widget mode:** leave it on **Managed**.
7. **Pre-clearance:** leave it on **No**.
8. Click **Create**.
9. You'll see a **Site key** and a **Secret key**. Copy both somewhere private for a minute.
   - The **site key** is public. Send it over, or paste it yourself into `PRODUCTION_SITE_KEY` in `web/src/lib/turnstile.ts`.
   - The **secret key** is private. Never paste it into a chat, a file, or a commit. You'll type it into the next command yourself.

Then set the secret on the Pages project (this needs the project from step 5 to exist first; run it right after the first deploy):

```powershell
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name offcut-ai
```

Paste the secret key when it asks, press Enter, then redeploy (step 5) so the Functions pick it up.

## 4. Cloudflare Web Analytics (optional, owner, in the dashboard)

Free, cookie-less visit counts. Pick **one** of these two ways, not both, or every visit counts twice.

**A. Token in the code (recommended: you can see it's on, and the privacy page matches):**

1. Dashboard → **Analytics & Logs** → **Web Analytics** → **Add a site**.
2. **Hostname:** `offcut-ai.pages.dev` → **Done**.
3. Cloudflare shows a JavaScript snippet. Copy just the token: the 32 letters and numbers after `"token": "`.
4. Paste it into `CF_ANALYTICS_TOKEN` in `web/vite.config.ts` (or set `VITE_CF_ANALYTICS_TOKEN` in `web/.env.local`). The build then adds the beacon to every page. With it empty, no analytics script is included at all.
5. Rebuild and deploy.

**B. One click on the Pages project:** Workers & Pages → `offcut-ai` → **Metrics** → **Web Analytics** → **Enable**. Cloudflare injects the beacon itself on the next deploy. Leave `CF_ANALYTICS_TOKEN` empty if you use this.

Either way, keep the "Counting visits" section in `web/privacy.html`. If you never turn analytics on, delete that section.

## 5. First deploy (asks before running)

Create the Pages project once, with `main` as the production branch:

```powershell
npx wrangler pages project create offcut-ai --production-branch main
```

If Cloudflare says `offcut-ai` is taken, it gives you a different `*.pages.dev` address. Then update `ALLOWED_ORIGINS` under `[env.production.vars]` in `wrangler.toml`, the canonical and `og:` URLs in `web/index.html`, `web/privacy.html` and `web/terms.html`, the Turnstile hostname, and the Web Analytics site.

Build and deploy (never the root `npm run build`; it wipes `web/node_modules`). The engine's packages must be installed once with `npm --prefix engine ci`, because the website imports the engine's source:

```powershell
npm --prefix web run build
npx wrangler pages deploy web/dist --project-name offcut-ai --branch main
```

Deploying from branch `main` goes to production, which uses `[env.production]`. Any other branch makes a preview URL, which uses the top-level settings (localhost origins), so forms and votes are rejected on previews. That's on purpose.

## 6. Smoke test the live site

- [x] `https://offcut-ai.pages.dev/api/health` answers `{"ok":true,...}`.
- [x] The roadmap shows five features with vote counts.
- [x] Vote, reload, take the vote back.
- [x] Join the waitlist with your own email, then check it landed:
      `npx wrangler d1 execute clipper-db --remote --command "SELECT email, source, created_at FROM waitlist"` (verified: 1 row).
- [x] `https://offcut-ai.pages.dev/anything` shows the Offcut 404 page.
- [x] `/privacy` and `/terms` load, with no "Draft" notice left.
- [x] Paste the URL into WhatsApp or <https://www.opengraph.xyz> and check the share card shows.
- [x] The browser console shows no "Turnstile: using the test site key" warning.

## 7. GitHub (asks before pushing)

- [x] Pushed to GitHub `https://github.com/psuvraneel-cyber/OffCut` on branch `main`.

## Later

- Before ads: buy a domain (AdSense needs one), add it to Pages, Turnstile, Web Analytics and `ALLOWED_ORIGINS`, apply for AdSense, add a certified consent tool for EU/UK visitors, and update the privacy page.
- Never add `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers.
