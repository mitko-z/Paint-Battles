# Deploy Drawing-Battle (Azure + Supabase)

## Environments

| Env | App | Backend |
|-----|-----|---------|
| Local | Expo (`npm start`) | Supabase local or shared **dev** project |
| Dev / Prod web | Azure Static Web Apps | Separate Supabase **dev** / **prod** projects |

Never put `OPENAI_API_KEY` or the service role key in Expo/`EXPO_PUBLIC_*` variables.

## Supabase (prod)

1. Create a prod project.
2. Enable **Anonymous** auth.
3. Apply `supabase/migrations/20260311000000_initial.sql`.
4. Deploy `judge-match` and set secrets:

```bash
supabase link --project-ref <prod-ref>
supabase db push
supabase functions deploy judge-match
supabase secrets set OPENAI_API_KEY=...
```

5. Confirm Storage bucket `drawings` exists and Realtime is enabled for `matches`, `rooms`, `match_submissions`.

## Azure Static Web Apps

1. Create a Static Web App in Azure (GitHub integration or token-based).
2. Add GitHub repo secrets:
   - `AZURE_STATIC_WEB_APPS_API_TOKEN` — from Azure SWA → Manage deployment token
   - `EXPO_PUBLIC_SUPABASE_URL` — prod Supabase URL
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` — prod anon key
3. Push to `main` (or run the workflow manually). The workflow typechecks, exports Expo web to `dist/`, and deploys.

SPA routing is handled by `staticwebapp.config.json` (copied into `dist` during CI).

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
- [ ] Judge function deployed; OpenAI secret set
- [ ] Azure SWA HTTPS live
- [ ] Smoke: lobby → room join (two clients) → draw → results
- [ ] Measure `judge_latency_ms` stays under 3s when OpenAI is configured
