# Deploy Drawing-Battle (Azure + Supabase)

## Environments

| Env | App | Backend |
|-----|-----|---------|
| Local | Expo (`npm start`) | Supabase local or shared **dev** project |
| Dev / Prod web | Azure Static Web Apps | Separate Supabase **dev** / **prod** projects |

Never put `GEMINI_API_KEY` or the service role key in Expo/`EXPO_PUBLIC_*` variables — the key must only ever exist as a Supabase Edge Function secret (see below).

## Supabase (prod)

1. Create a prod project.
2. Enable **Anonymous** auth.
3. Apply migrations under `supabase/migrations/`.
4. Deploy `judge-match` and set secrets:

```bash
supabase link --project-ref <prod-ref>
supabase db push
supabase functions deploy judge-match --use-api
supabase secrets set GEMINI_API_KEY=...
```

`--use-api` is required here because `geminiJudge.ts` imports `src/lib/vision/types.ts` directly, outside `supabase/functions/`. Without the flag, the standard Docker-based deploy can't reach outside its own function subtree. Supabase's own docs still mark `--use-api` experimental (CLI ≥2.13.3) — if it misbehaves, the fallback is dropping the flag and duplicating the three `VisionJudge` types locally in `geminiJudge.ts` instead (that version is in git history). Note `--use-api` only affects **deploy**; local `supabase functions serve` still needs Docker either way.

### Storing and reading `GEMINI_API_KEY`

This is an **Edge Function secret**, not Supabase Vault — worth being precise about, since Supabase has two different things people call "the vault":

- **Edge Function secrets** (what we use): environment variables scoped to Edge Functions, read via `Deno.env.get("GEMINI_API_KEY")`. That line is already in `judge-match/index.ts` — no extra retrieval code needed once the secret is set. This is the standard place for a third-party API key an Edge Function calls out to.
- **Supabase Vault** (a different feature): an encrypted-secrets table living *inside Postgres*, meant for secrets a database function, trigger, or webhook needs to read via SQL (`vault.decrypted_secrets`). It's not designed for Edge Functions and isn't involved here — the two are easy to conflate because the Dashboard has separate pages for each.

**To set it, pick one:**

- **CLI** (what the command block above does):
  ```bash
  supabase secrets set GEMINI_API_KEY=your-key-here
  ```
  Or from a file: `supabase secrets set --env-file .env` (never commit that file).

- **Dashboard**: your project → **Edge Functions** → **Secrets** (a different page from **Vault**, which appears separately in Database settings) → add `GEMINI_API_KEY` and its value → Save. Takes effect immediately, no redeploy needed.

- **List / verify what's set**: `supabase secrets list` (shows names only, not values — there's no way to read a secret's value back out once set, by design).

- **Local dev**: create `supabase/functions/.env` (already covered by the repo's root `.gitignore` `.env` pattern — double-check it isn't tracked before your first commit with it) with `GEMINI_API_KEY=...`. `supabase functions serve judge-match` picks it up automatically. See `supabase/functions/.env.example` for the expected shape.

Get the key itself from [Google AI Studio](https://aistudio.google.com/apikey) — keys are now auto-created as "auth keys," no restricted/unrestricted config to pick.

### Free tier tradeoff and the rate-limit decision

We're on the **free tier** by deliberate MVP tradeoff (team decision, 2026-08-25): a free, working game beats a paid, polished one for this first pass, so the <3s latency target and best-possible judging quality are explicitly not being optimized for yet.

**Resolved:** when the free tier's rate limit is hit (`429 RESOURCE_EXHAUSTED`), we don't retry (pointless within the same per-minute window) and we don't declare a draw. `judge-match` falls back to the same heuristic (non-AI) judge used when no key is configured at all — a real winner still gets picked. No new DB column tracks this (team preferred to avoid the schema change — see "Tracking and rolling back database changes" below); instead `app/results/[id].tsx` infers a "AI judging temporarily unavailable" notice from the rationale text the judge already writes to `match_submissions.rationale`, and the full structured record (including a `rate_limited`/`timeout`/`error_fallback`/`scored` outcome) is still written to the Edge Function's logs — see `judge-match/index.ts`'s `logJudgment`.

**Still worth knowing going into the beta window:** the actual limits reported from the AI Studio page for `gemini-3.6-flash` are **RPM 5, TPM 250K, RPD 20**. One match = one Gemini request, so that's roughly **20 AI-judged matches per day** before everything else that day quietly runs on the heuristic judge instead. Against the "100 matches" beta target, that likely means either spreading the beta window across several days, or checking whether a different model / tier has more free-tier headroom before assuming 100 matches will actually exercise real AI judging rather than mostly the fallback.

5. Confirm Storage bucket `drawings` exists and Realtime is enabled for `matches`, `rooms`, `match_submissions`.

### Tracking and rolling back database changes

**Tracking is already automatic, for free:** every schema change is a `.sql` file in `supabase/migrations/`, and that folder is just part of the repo — git history *is* the change log (who changed what, when, and why, via the commit that added the file). Supabase separately tracks which migrations have actually run against a given database in a `supabase_migrations.schema_migrations` table, so `supabase db push` only applies the files that database hasn't seen yet. The one rule that keeps this working: never hand-edit a database through the Dashboard's Table/SQL editor — every change goes through a migration file, or the two get out of sync.

**Normal workflow (already what the two existing migrations in this repo follow):**
```bash
supabase migration new describe_the_change   # scaffolds a new timestamped .sql file
# edit the file
supabase db reset                            # replays ALL migrations against your local DB from scratch — catches mistakes here, for free, before anything shared is touched
# commit the file, push/PR as normal
supabase db push                             # applies only the new migration(s) to the linked (dev or prod) project
```
Running against local first, then a shared **dev** project, then **prod** last (per the Environments table above) means a bad migration gets caught before it ever reaches the database players' data lives in.

**If a migration already applied and broke something:** there's no automatic "undo" — Supabase migrations are forward-only. The fix is to write a *new* migration that reverses the change (e.g. the mistake was `add column`, the fix is a follow-up migration with `drop column`), not to edit or delete the original file. This keeps the history honest and matches what everyone else's local/dev copies expect to apply next. If the tracking table itself ever gets out of sync with reality (e.g. someone applied something outside the CLI), `supabase migration repair` fixes the bookkeeping without running SQL.

**Free tier has no safety net beyond that** — worth knowing given the whole stack is on free tiers by design: the Free Supabase plan has no automatic daily backups and no point-in-time recovery (both are Pro-plan-and-up add-ons). The documented fallback for Free plan projects is running `supabase db dump` yourself before anything risky and keeping that export somewhere safe. Given that, "test locally, then dev, then prod" above isn't just good practice here — for now it's the only real protection against a bad migration reaching data you can't get back.

## GitHub Pages

Deploys are **tag-triggered, not branch-triggered**: pushing a `vX.Y.Z` tag is what ships a build (`.github/workflows/deploy-latest-tag.yml`). A `check` job compares the pushed tag against every other tag in the repo (`git tag --list 'v[0-9]*.[0-9]*.[0-9]*' | sort -V | tail -n1`) and the build/deploy jobs only run if it's the highest one, so an out-of-order hotfix tag can never accidentally regress production. Plain pushes to `main` do **not** deploy anything by themselves.

We moved off Azure Static Web Apps (2026-08-31) — the account it was created under belonged to a teammate who's since left, and the corporate Azure account replacing it turned out to be read-only (no permission to create resources). GitHub Pages needs **no external account at all** since the repo is public, which sidesteps that problem entirely.

**One-time setup (human, ~2 minutes, no CLI):**
1. Repo → **Settings → Pages → Build and deployment → Source** → set to **"GitHub Actions"** (not "Deploy from a branch"). That's the only manual step — no tokens, no external signup.
2. Confirm `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are already set as repo secrets (Settings → Secrets and variables → Actions) — carried over from the original setup, GitHub Pages doesn't need any secret of its own.

**Ship a version:** `git tag v1.0.0 && git push origin v1.0.0` (bump the number each release; tag whatever commit is on `main` when you cut a release). Or re-run manually from the Actions tab (`workflow_dispatch`) to redeploy the current highest tag without cutting a new one.

Watch the run under the repo's **Actions** tab; the live URL is `https://mitko-z.github.io/Paint-Battles/` (shown on Settings → Pages once the first deploy succeeds) — worth pinning/sharing once, since it never changes across releases.

**Subpath gotcha, already handled:** GitHub Pages serves a project repo under `/Paint-Battles/`, not the domain root, so `app.json`'s `experiments.baseUrl` is set to `/Paint-Battles` — without it, the exported build's asset URLs would resolve at the wrong path and the page would load blank. If the repo is ever renamed, this value has to be updated to match. This also means local `expo start --web` now serves under `http://localhost:8081/Paint-Battles/` instead of the root — open that path, not `localhost:8081/`, when testing web locally.

SPA routing (so a deep link like `/room` doesn't 404 on a fresh page load) is handled by copying `dist/index.html` to `dist/404.html` during CI — GitHub Pages serves that on any unmatched path, and expo-router's client-side router then takes over. `staticwebapp.config.json` is a leftover from the Azure attempt and is no longer used by the deploy — safe to delete whenever, harmless to leave.

## Mobile binaries

Use EAS Build when ready for store / internal distribution. Point the same `EXPO_PUBLIC_*` values at prod Supabase.

**Important — `.env` is gitignored, so EAS Build never sees it.** `eas build` runs in
the cloud on a fresh clone of the repo, not your local machine, so it does not pick
up your local `.env` file at all. `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` for mobile builds instead come from **EAS's own
environment variables**, configured separately per build profile
(`development` / `preview` / `production`). These are a completely separate place
from `.env` and do **not** update automatically when `.env` changes — if you switch
Supabase projects locally and forget to update EAS's copy too, mobile builds will
silently keep pointing at the old project. Nothing will error; the app will just
work fine on its own while being unable to see data from any other platform (this
already happened once — web and Android were talking to two different Supabase
projects for a while with no error message anywhere).

Check what's currently configured:

```bash
eas env:list --environment preview
```

Update a value (use `eas env:create` instead if the variable doesn't exist yet for
that environment):

```bash
eas env:update --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co --environment preview
eas env:update --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key> --environment preview
```

Repeat for `development` and `production` as needed, then rebuild
(`eas build --platform android --profile preview`) — a config-only change like this
requires a fresh build to take effect, since the values are baked in at build time.

## Production checklist

- [ ] Dev and prod Supabase isolated
- [ ] Anonymous auth + email magic link configured
- [ ] RLS migration applied
- [ ] Judge function deployed (`--use-api`); `GEMINI_API_KEY` secret set
- [ ] Azure SWA HTTPS live
- [ ] Smoke: lobby → room join (two clients) → draw → results
- [ ] Measure `judge_latency_ms` across a batch of matches (target <3s) and spot-check the Edge Function logs for `judge_result` outcomes — expect mostly `scored`, with `rate_limited` showing up once ~20 matches/day are exceeded
