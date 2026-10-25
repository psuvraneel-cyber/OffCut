# Brief for Antigravity: take Offcut live

Paste everything below the line into Antigravity (Gemini 3.8 Flash, High) with the workspace opened at `C:\OffCut`.

---

You are continuing work on **Offcut** in the folder `C:\OffCut` on Windows 11 (PowerShell). Another AI (Claude) did the work so far and stopped. Your job is to **take the marketing site live on Cloudflare Pages's free tier**, step by step, with the owner approving every step that touches their accounts. Read this whole brief before doing anything. Follow it exactly. When the brief and your own instincts disagree, the brief wins.

## 1. What Offcut is

- A free, open-source, in-browser AI video clipper. Long videos go in; captioned vertical Reels come out. All the AI runs on the user's device, so videos never leave their computer.
- The owner is building it in public on a new Instagram tech channel, with a budget of **₹0**. Everything must stay on free tiers.
- Later income: display ads on the processing screen, plus optional rewarded ads. Not yet.
- Brand: name **Offcut**. Palette: night `#120b24`, violet `#7a4dff`, violet-deep `#4b23c8`, orchid `#d77bff`, lilac `#c9b8ff`, mist `#f1ecff`, signal `#6fe3ff`. Fonts: Instrument Serif, Inter, JetBrains Mono (self-hosted). "clipper" is the old internal codename and survives only in package names and the database name `clipper-db`.
- Live address: **`https://offcut.pages.dev`** (Cloudflare Pages project `offcut`). Not Vercel: its free plan bans commercial use.

## 2. Read these first, in this order

1. `HANDOFF.md`, especially "Status right now", "Key decisions" and "Gotchas".
2. `docs/launch.md`: the production checklist. Sections 2–7 are your task.
3. `wrangler.toml`.
4. `docs/backend.md`, only if you need backend details.

Then run these and read the output:

```powershell
git status --short
git log --oneline -8
git log --oneline origin/main -1
npx wrangler whoami
```

Expected: branch `main`, a clean tree except an untracked `engine/` folder, local `main` a few commits ahead of `origin/main` (`c1389ec`), and wrangler logged in to the owner's account. If any of that is different, **stop and tell the owner what you see** before going further.

## 3. Hard rules (never break these)

1. **Ask before every outward-facing step, one at a time.** Say exactly what you will run and what it changes, then wait for the owner to reply with a clear yes. One yes covers one step only. Outward-facing steps are: creating the D1 database, running remote migrations, creating the Pages project, every deploy, setting secrets, pushing to GitHub, and anything else that changes their Cloudflare or GitHub account.
2. **Never see, type, store or repeat a secret.** The Turnstile **secret key** is typed by the owner into their own terminal. Never put it in a file, a chat message, a commit or a command line. The Turnstile **site key** and the Web Analytics token are public, so committing them is fine.
3. **Never run `npx wrangler login`, and never handle the owner's passwords.** If wrangler says it's not logged in, stop and ask the owner to run `npx wrangler login` themselves.
4. **Don't touch `engine/`.** Another agent (Omnirush) is working there. Don't open, edit, format, stage or commit anything in it. Never use `git add -A`, `git add .` or `git commit -a`; always `git add` named paths.
5. **Never run the root `npm run build`.** It runs `npm ci` inside `web/` and wipes `web/node_modules`. Build the site with `npm --prefix web run build`.
6. **Never add `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers** anywhere. They block the ads planned for later.
7. **Keep the API middleware at `functions/api/_middleware.ts`.** Never move it to the root of `functions/`: that would send every static file through Functions and burn the free quota.
8. **Don't redesign or refactor.** The hero (`web/src/hero/`), sections, styles and backend are finished and reviewed. Change only what a step below needs.
9. **Never create paid resources** or turn on anything that bills.
10. Don't delete anything you didn't create, and don't force-push.

## 4. Project facts you'll need

- Website: `web/`. React 19 + TypeScript + Vite 8, with GSAP/ScrollTrigger, Lenis and Three.js. The build output is `web/dist`. Vite entries: `index.html`, `privacy.html`, `terms.html`, `404.html`.
- Backend: Cloudflare Pages Functions in `functions/`, D1 database `clipper-db` (binding `DB`), migrations in `migrations/` (`0001_init.sql`, `0002_seed_features.sql`, which seeds five roadmap features), and Turnstile on every write endpoint. It stores no IPs and sets no cookies.
- `wrangler.toml`: top-level settings are for local development and preview deploys (`ALLOWED_ORIGINS` = localhost). `[env.production]` repeats the D1 binding and sets `ALLOWED_ORIGINS = "https://offcut.pages.dev"`. **Both** `database_id` lines are currently the placeholder `00000000-0000-0000-0000-000000000000`.
- Turnstile site key: `PRODUCTION_SITE_KEY` in `web/src/lib/turnstile.ts`, between the `▼▼▼`/`▲▲▲` markers, currently `''`. On localhost the site always uses Cloudflare's test key, so local testing never needs the real one.
- Analytics token: `CF_ANALYTICS_TOKEN` in `web/vite.config.ts`, currently `''`. It must be 32 hex characters or the build throws. While it's empty, no analytics script is added.
- Public links: `GITHUB_URL` and `INSTAGRAM_URL` in `web/src/lib/site.ts`. While they're empty, the site shows a "soon" badge.
- Legal drafts: `web/privacy.html` and `web/terms.html`. Each blank is a `<span class="legal__todo">[...]</span>`. Each file also has an `OWNER` HTML comment and a `legal__draft` notice block at the top that must go once the blanks are filled.
- Local backend for testing: `npm run dev:api` serves `web/dist` with the Functions at `http://localhost:8788`. It needs `npm run db:migrate:local` once. `.dev.vars` (git-ignored) holds the Turnstile **test** secret; never commit it.
- Checks: `npm --prefix web run build`, `npm --prefix web run lint`, `npm run typecheck:api`, `npm run test:api` (12 tests).
- If wrangler fails with errors about install scripts, run `npm approve-scripts` at the root, then retry.

## 5. The task, step by step

Do the steps in order. After each one, tell the owner in two or three plain sentences what happened and what comes next. The owner is new to this, so use simple words and explain any term you have to use.

### Step A: Collect the owner's details (no accounts touched)

Ask the owner for all of these in **one** message, and say they can skip any for now:

1. The name to show as the person running Offcut.
2. A contact email for privacy and terms questions.
3. Their city and state in India, for the terms' "courts of" clause.
4. How many days they promise to reply to privacy requests in. Suggest 30.
5. The liability cap in the terms. Suggest ₹1,000.
6. Their Instagram profile URL.
7. Whether the GitHub repo `https://github.com/psuvraneel-cyber/offcut` is (or will be) public, so it can be linked.
8. A licence. Offer three, with one line each, and recommend **MIT**:
   - **MIT**: anyone can reuse the code, including commercially. Simplest.
   - **Apache-2.0**: like MIT, plus an explicit patent grant.
   - **AGPL-3.0**: anyone who runs a modified copy as a website must publish their changes.

When they answer:

- Replace each matching `legal__todo` span with the plain text (remove the span itself, not just the brackets). For the licence blank in `terms.html`, write the licence name and link to the repo.
- Only if every blank in a file is filled: delete that file's `legal__draft` block and its `OWNER` HTML comment, and change "Draft of 25 October 2026" in the meta line to "Last updated 25 October 2026" (or that day's date). Leave anything still unknown as a highlighted blank, and tell the owner which ones remain.
- Set `INSTAGRAM_URL`, and set `GITHUB_URL` only if the repo is public.
- Add a standard `LICENSE` file for the chosen licence, with "Copyright (c) 2026 <owner name>".
- Run the build and lint. Open `/privacy` and `/terms` in the browser and check the text reads correctly.
- Commit: `git add web/privacy.html web/terms.html web/src/lib/site.ts LICENSE` and the message `Site: owner details, links and licence`.

### Step B: Create the D1 database (ask first)

Ask: "May I create the free D1 database `clipper-db` in your Cloudflare account?" After a yes:

```powershell
npx wrangler d1 create clipper-db
```

If wrangler offers to add the binding to the config for you, answer **No**. Copy the `database_id` (a UUID) from the output into **both** `database_id` lines in `wrangler.toml`: the top-level `[[d1_databases]]` and `[[env.production.d1_databases]]`. Change nothing else in that file. The ID isn't secret.

Commit: `git add wrangler.toml` with the message `Config: real D1 database id`.

### Step C: Create the tables remotely (ask first)

Ask: "May I create the tables and the five roadmap items in the live database?" After a yes:

```powershell
npm run db:migrate:remote
```

If it asks to confirm, answer yes. Both migrations should show ✅. Running it again is safe, because D1 remembers which migrations it applied.

### Step D: Turnstile widget (the owner does this in the dashboard)

Give the owner the click-by-click steps from `docs/launch.md` section 3 (steps 1–9), in your own words. Make clear that:

- They should send you **only the site key**.
- They keep the **secret key** private and will type it into a command themselves later (Step G).

When you have the site key (it usually starts with `0x4`), put it into `PRODUCTION_SITE_KEY` in `web/src/lib/turnstile.ts`, between the quotes. Change nothing else there. Build and lint.

Commit: `git add web/src/lib/turnstile.ts` with the message `Site: production Turnstile site key`.

If the owner wants analytics now, follow `docs/launch.md` section 4, option A: put the 32-character token into `CF_ANALYTICS_TOKEN` in `web/vite.config.ts`, build, and commit it as `Site: Cloudflare Web Analytics token`. If they don't want analytics, delete the "Counting visits" section (the HTML comment that starts `OWNER: this section is true once CF_ANALYTICS_TOKEN` and the `<h2>` and `<p>` after it) from `web/privacy.html`, and commit that instead.

### Step E: Create the Pages project (ask first)

Ask: "May I create the free Cloudflare Pages project `offcut`, with `main` as its live branch?" After a yes:

```powershell
npx wrangler pages project create offcut --production-branch main
```

If the name `offcut` is taken or the address isn't `offcut.pages.dev`, **stop and tell the owner**. The address then has to change in every place listed in `docs/launch.md` section 5. Do that only after they agree.

### Step F: First deploy (ask first)

Build fresh, then ask: "May I publish the site to https://offcut.pages.dev?" After a yes:

```powershell
npm --prefix web run build
npx wrangler pages deploy web/dist --project-name offcut --branch main --commit-dirty=true
```

`--commit-dirty=true` is only there because of the untracked `engine/` folder. Deploying from branch `main` makes it the live (production) deployment, which uses the `[env.production]` settings. Then check that `https://offcut.pages.dev/api/health` returns JSON with `"ok":true`.

### Step G: Turnstile secret (the owner types it)

Ask the owner to run this **themselves** in their own terminal and paste the secret key when it asks:

```powershell
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name offcut
```

Don't run it for them, and never ask them to paste the secret to you. When they say it's done, ask for a yes to redeploy so the Functions pick up the secret, then run the same build and deploy commands as Step F again.

### Step H: Smoke test the live site (read-only, no approval needed)

In the browser, at both **1280×800** and **375×812**, go through `docs/launch.md` section 6:

- `/api/health` answers `"ok":true`.
- The roadmap shows five features with counts. **Don't vote or join the waitlist yourself**, because that would write test data into the live database. Instead, ask the owner to vote once, reload, take the vote back, and join the waitlist with their own email.
- After the owner joins, you may run this read-only query, and show them only the row count, not the emails:
  `npx wrangler d1 execute clipper-db --remote --command "SELECT COUNT(*) AS n FROM waitlist"`
- `https://offcut.pages.dev/some-missing-page` shows the Offcut 404 page.
- `/privacy` and `/terms` load, with no Draft notice left (unless blanks remain).
- The browser console has no `Turnstile: using the test site key` warning and no errors.
- Ask the owner to paste the URL into WhatsApp, or check <https://www.opengraph.xyz>, to see the share card with the Offcut image.

If something fails, explain it plainly, find the cause, fix it with the smallest change, rebuild, and ask before redeploying.

### Step I: Push to GitHub (ask first)

Run `git status --short`. Only `engine/` may be untracked. Then ask: "May I push the finished site to GitHub (`git push origin main`)? It's a normal push, not a force push." After a yes:

```powershell
git push origin main
```

If the push is rejected because GitHub has new commits, **don't force-push**. Run `git fetch` and `git log --oneline main..origin/main`, show the owner what's new, and ask how to proceed.

### Step J: Wrap up

1. In `HANDOFF.md`, rewrite "Status right now": what's live, the D1 ID is set, Turnstile is real, analytics on or off, pushed or not, and what's still left.
2. In `docs/launch.md`, tick the boxes that are done.
3. Commit those two files as `Docs: live on offcut.pages.dev`, and ask before pushing that commit too.
4. Give the owner a short final summary:
   - the live URL
   - what you did, step by step
   - what's still theirs to do: any blanks left, getting the legal pages reviewed, and before ads a domain, AdSense and a consent tool
   - a suggested Instagram post idea for the launch

**Then stop.** Don't start building the video tool or touch `engine/`. That's the next project, with its own brief.

## 6. How to work

- Commit after each step that changes files, using `git add <named paths>` only. Commit messages follow the existing style: `Area: what changed`, in plain words.
- Run `npm --prefix web run build` and `npm --prefix web run lint` before every commit that touches `web/`. Run `npm run typecheck:api` and `npm run test:api` if you touch `functions/`, `shared/`, `migrations/` or `test/` (you shouldn't need to).
- Never claim something works without checking it. If a command fails, show the important line of the error and what you'll try next. Don't retry the same failing command in a loop.
- If you're unsure whether something is safe or what the owner wants, ask. A short question costs less than a wrong change to a live site.
