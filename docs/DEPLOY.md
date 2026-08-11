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

## Production checklist

- [ ] Dev and prod Supabase isolated
- [ ] Anonymous auth + email magic link configured
- [ ] RLS migration applied
- [ ] Judge function deployed; OpenAI secret set
- [ ] Azure SWA HTTPS live
- [ ] Smoke: lobby → room join (two clients) → draw → results
- [ ] Measure `judge_latency_ms` stays under 3s when OpenAI is configured
