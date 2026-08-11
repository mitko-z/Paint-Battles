# Drawing-Battle

A real-time 1v1 training project where players sketch a prompt in 60 seconds and an AI Vision model judges the winner.

## Product

See the problem / solution / MVP scope in this README below, and the full technical plan in [`plan.md`](plan.md).

**Stack:** Expo (iOS / Android / web) · Supabase (Auth, Postgres, Realtime, Storage, Edge Functions) · OpenAI GPT-4o vision · Azure Static Web Apps (prod web)

---

## Local setup

### Prerequisites

- Node 20+
- npm
- A [Supabase](https://supabase.com) project (or local Supabase CLI + Docker)
- Optional: OpenAI API key for real AI judging (heuristic fallback without it)

### 1. Install

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 2. Supabase

1. In the Supabase dashboard → **Authentication → Providers**, enable **Anonymous** sign-ins.
2. Run the migration in [`supabase/migrations/20260311000000_initial.sql`](supabase/migrations/20260311000000_initial.sql) (SQL editor, or `supabase db push` / `supabase migration up`).
3. Deploy the judge function:

```bash
supabase functions deploy judge-match
supabase secrets set OPENAI_API_KEY=sk-...
```

Without `OPENAI_API_KEY`, judging still completes using a deterministic heuristic so you can test the full loop locally.

### 3. Run the app

```bash
npm start
# then press w (web), a (Android), i (iOS)
# or:
npm run web
```

**Play locally:** open two browser tabs (or phone + web), use **Create room** / **Join** with the shared code. Queue works when two clients are waiting.

Debug with browser DevTools (web) or the Expo / React Native debugger (native).

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Expo dev server |
| `npm run web` | Web only |
| `npm run typecheck` | TypeScript check |
| `npm run export:web` | Static web export → `dist/` |

---

## Azure production deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md). CI workflow: [`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml).

Required GitHub secrets:

- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

---

## App routes

- `/lobby` — play, create/join room, queue
- `/queue` — public matchmaking
- `/room` — private room waiting
- `/match/[id]` — countdown + canvas + submit
- `/results/[id]` — scores and winner
- `/profile` — W/L, name, email magic link upgrade

---

# Problem

Who has this pain, how big/frequent
is it:
• Internal: The engineering team lacks a
unified, practical project to master AI
integrations and real-time server sync.
• External: Casual mobile gamers want
quick, creative, and competitive games.
What do they do today instead:
• Internal: Devs rely on dry tutorials or
disconnected mini-tasks.
• External: Users play slow
asynchronous games or time-
consuming multiplayer games.

# Solution

Core idea in plain language:
• A real-time game where matched
players get a random prompt and 1
minute to draw it. An AI evaluates both
sketches and declares the closest match
the winner.
Why this approach solves it:
• It acts as a comprehensive, hands-on
training ground encompassing UI,
WebSockets, AI APIs, and DBs, while
also creating a highly engaging product.

# Target users & values

Primary user / buyer:
• Internal development team.
• Casual gamers and friend groups.
Value:
• Risk removed: De-risks future
enterprise AI and real-time sync
projects by building in-house expertise
in a low-stakes environment.
• Time saved: Delivers a complete
competitive game loop in under 2
minutes.

# MVP SCOPE (in / out)

Must-have for v1:
• Real-time 1v1 matchmaking & server
synchronization.
• Mobile-friendly canvas (pen and
eraser).
• Third-party AI Vision API integration
for scoring.
• Basic profiles with win/loss records.
Explicitly OUT of scope for v1:
• Complex Elo-based ranking ladders.
• Monetization, ads, or in-app
purchases.
• Social features (friends lists, chat,
avatars).
• Advanced drawing tools (colors,
layers)

# SUCCESS METRIC

• Metric 1: 100 head-to-head matches
completed without server
desynchronization during the internal
beta.
• Metric 2: AI scoring latency remains
under 3 seconds per match.

# KEY ASSUMPTIONS & DEPENDENCIES

What must be true for this to work:
• AI vision models can accurately
evaluate fast, unpolished 1-minute
doodles.
• Real-time sync can be handled
smoothly on typical mobile networks.
External systems/teams/data
needed:
• Cloud hosting infrastructure (Azure).
• API key for a commercial AI Vision
model.
• Supabase project (Auth, DB, Realtime, Storage).
