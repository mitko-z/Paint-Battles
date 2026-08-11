# Paint Battles — Internal Hard Requirements (v0.1 draft)

**Status:** v0.3 — reconciled against `plan.md` (repo root, still under team debate, not yet locked)
**Source:** Converts the soft targets in the kickoff doc ("100 matches," "<3s AI latency") into specific, testable engineering requirements
**Stack proposed in plan.md (pending debate):** Expo (React Native, one codebase for iOS/Android/web) · Supabase (Auth, Postgres, Realtime, Storage, Edge Functions) · OpenAI GPT-4o vision behind a swappable adapter
**Timeline/process note:** team has moved off the original ~2-week framing — code will be largely AI-generated with the team's job centered on review/understanding, and v1 is now scoped against a realistically longer timeline rather than a 2-week sprint. The acceptance criteria below still hold; they're no longer written under speed pressure.
**Resolved (team agrees, not just plan.md's default):** backend approach (Supabase), auth mechanism, hosting
**Still genuinely open:** AI Vision provider (bake-off in progress, owner assigned — see §3), and everything flagged inline below as a gap in plan.md's current draft

> Note: this draft doesn't touch WHY we're building what's in the PDF — it exists to make the vague parts (mainly section 5, "Success Metrics") concrete enough that any dev can build against them without asking "how strict is strict." Cut/edit freely on Slack.

---

## 1. Real-Time Matchmaking & Sync

| # | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| R1.1 | Two players requesting a match are paired and both receive match-start within a fixed time budget | P0 | Given both players tap "Find Match" within 5s of each other, then both receive `match_start` with the same prompt within **2 seconds** of the second player joining |
| R1.2 | Both players see an identical countdown clock | P0 | Server is the single source of truth for the timer; client countdowns may never drift more than **500ms** from server time (resynced at least every 15s) |
| R1.3 | A dropped connection does not immediately forfeit the match | P0 | Given a player disconnects mid-match, then they have **10 seconds** to reconnect and resume with the same timer state before the match auto-forfeits to the opponent |
| R1.4 | No desync between what each player's timer/submission state shows and server state | P0 | This is the literal beta-exit metric — see §5 for how we count it |
| R1.5 | Matchmaking queue timeout | P1 | If no opponent found within **30 seconds**, show the player a "still looking / cancel" option rather than an indefinite spinner |
| R1.6 | Private room codes work under the same sync guarantees as the public queue | P1 | Joining via a 6-char code and joining via the public queue must both satisfy R1.1–R1.4 — no separate, looser bar for rooms just because they're not in `plan.md`'s original success metrics |

**Proposed in plan.md (pending debate):** no custom WebSocket server — sync runs on Supabase Realtime channels subscribed to the `matches` row, with the server-stored `drawing_ends_at` timestamp as source of truth (matches R1.2's intent).

**New open question (engineering, blocking before hardening):** R1.1–R1.4's numbers (2s match-start, 500ms drift, 10s reconnect) were written before a backend was chosen. Nobody has yet confirmed Supabase Realtime actually hits these on a typical mobile network — this needs a quick spike/test, not just an assumption that "managed realtime = fast enough." If it doesn't hit the budget, we either loosen the numbers or add client-side compensation.

---

## 2. Drawing Canvas

| # | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| R2.1 | Pen and eraser only, no color/layers (per PDF non-goals) | P0 | Canvas UI exposes exactly 2 tools; verified in code review, not just design |
| R2.2 | Canvas performs on a mid-range mobile device | P0 | No visible input lag (dropped strokes, stutter) on a 3-year-old mid-tier Android device during a 60s continuous-draw stress test |
| R2.3 | Drawing is captured as an image suitable for the Vision API | P0 | Exported as PNG, fixed resolution (TBD once provider is picked — see §3), under whatever size limit that provider imposes |
| R2.4 | Auto-submit at timeout | P0 | Given the 60s timer reaches 0 and the player hasn't tapped submit, then the current canvas state is submitted automatically within **1 second** of timeout, no player action required |

---

## 3. AI Vision Scoring

The PDF's "<3s" target was flagged in the meeting as ambitious. Turning it into something we can actually engineer against:

| # | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| R3.1 | Define what "scoring latency" measures | P0 | Clock starts when **both** players' drawings have been submitted (or auto-submitted); clock stops when both clients receive the result. This is the number we report against the 3s target — not raw API response time alone |
| R3.2 | Target vs. hard ceiling | P0 | **Target:** under 3s for the full round-trip (submit → result). **Hard ceiling:** if it exceeds **8s**, the match does not hang — see R3.3 |
| R3.3 | Timeout/fallback behavior when the Vision API is slow or errors | P0 | Given the Vision API hasn't responded within 8s, then the match is declared a **draw** (not left hanging), and the event is logged as a "scoring timeout" for later tuning — no player-facing crash or infinite spinner under any circumstance |
| R3.4 | Retry policy | P1 | One automatic retry on API error/timeout before falling back to R3.3's draw behavior; no more than one retry (avoid compounding latency) |
| R3.5 | Provider bake-off before committing | P0 (blocking) | At least 2 candidate Vision APIs tested against ~10 sample sketches each, latency and judging-quality logged, before picking one for the skeleton |

**Proposed in plan.md (still open, not yet team-agreed):** OpenAI GPT-4o vision, called from an Edge Function (key never on client), behind a `VisionJudge` interface so Gemini/Claude are drop-in swaps. plan.md picked this as a default, but **R3.5's actual bake-off has not happened** — this was decided without a debate or comparative test.

**Status: reopened, owner assigned.** A teammate is now running the bake-off (≥2 providers, ~10 sample sketches each, latency + judging-quality logged, per R3.5). Until that's done, treat OpenAI as a placeholder, not a decision — the `VisionJudge` interface is good either way since it doesn't force the outcome, but R3.1–R3.4's latency numbers shouldn't be considered validated against "the" provider yet.

---

## 4. Auth & Profiles

| # | Requirement | Priority | Acceptance Criteria |
|---|---|---|---|
| R4.1 | Simple auth (per PDF: "basic") | P0 | Player can create an account and log back in; exact mechanism (email/password vs. anonymous device ID vs. magic link) is an **open question**, not yet decided |
| R4.2 | Win/loss record | P0 | Every completed match (including R3.3 draws — decide if draws count as neither/both) updates both players' profiles; visible on a basic profile screen |
| R4.3 | No social features (per PDF non-goals) | P0 | No friends list, chat, or avatars in v1 — flag in review if these creep in |

**Proposed in plan.md (pending debate):** Supabase anonymous sign-in for guests (auto-creates a `profiles` row) with optional email/OAuth upgrade that keeps the same `profiles.id` — so win/loss persists through the upgrade. If the team agrees, this answers the open question: beta testers can start as guests, no forced account creation on day 1.

---

## 5. "100 Matches" — Making the Beta Metric Actually Countable

The PDF says "100 head-to-head matches completed without server desynchronization." Right now nobody has defined *how we'll know* a match hit that bar or *who's playing the 100 matches*. Proposed hard definition:

- **What counts as a match:** a full match from `match_start` to a scored result (win/loss/draw) being shown to both players. Matches that never reach `match_start` (e.g., matchmaking cancelled) don't count.
- **What counts as "desync":** any of — (a) the two clients' timers disagree by >500ms at result time, (b) one client shows a different winner than the other, (c) a client crashes or hangs requiring app restart mid-match. Any of these flags the match as failed, not just "not perfect."
- **Instrumentation (P0, blocking the metric itself):** every match must log a structured record (match ID, both player IDs, start/end timestamps, scoring latency, desync flag y/n) — without this we cannot actually count the 100, we'd just be guessing.
- **Who plays them:** proposed — internal team (7 people) plus invited friends/family during a defined beta window, not organic public traffic. **Open question (team):** do we have a target date range for this beta window, and is 7 teammates + friends actually enough distinct pairings to reach 100 matches without it being the same 2-3 people grinding it out? (`plan.md`'s private room codes actually help here — they let us deliberately pair specific testers on demand instead of relying on the public queue to happen to match them, which makes hitting 100 distinct-ish matches during a short beta more controllable.)

**Gap in plan.md (engineering, should close before Phase 6 "Hardening"):** the data model (`matches`, `match_submissions`) captures match outcomes but not the structured instrumentation record this section requires — no explicit desync-flag or scoring-latency field anywhere in the schema yet. `plan.md`'s own Phase 6 already calls out "latency/desync instrumentation" as a to-do, so this isn't contradicted, just not yet designed — flag it so it doesn't get skipped when Phase 6 arrives.

---

## 6. Explicit Non-Goals (carried over from PDF, restated as hard "do not build")

- No Elo/ranking ladder
- No monetization/ads/IAP
- No friends list, chat, or avatars
- No color palette or layers in the canvas
- No custom-trained AI model — off-the-shelf Vision API only

If any of these show up in a PR, that's scope creep per the pre-mortem — flag it rather than merge it.

---

## 7. Open Questions Needing Answers (blocking vs. non-blocking)

| Question | Blocking? | Who answers |
|---|---|---|
| Backend framework/language for the WebSocket + match server | **Blocking** (R1.x) | Engineering |
| Which AI Vision API provider | **Blocking** (R3.x) | Engineering, via bake-off |
| Auth mechanism (real accounts vs. device pseudo-accounts for beta) | **Blocking** (R4.x, M1 scope) | Engineering |
| Hosting (AWS/GCP/other) | Non-blocking short-term, blocking before beta | Engineering |
| Beta window dates + who's recruited to hit 100 matches | Non-blocking for coding, blocking for the metric | Team/Martin |
| Do draws (R3.3 fallback) count toward win/loss records? | Non-blocking | Engineering (product-adjacent call) |

---

## Note worth raising on Slack

The team's earlier stack discussions (FastAPI vs. ASP.NET/SignalR) assumed a web app, and most of the team's hands-on experience skews .NET/Python with only one person strong in JS/Node. The meeting notes now say React Native. That's a real shift in what's easy vs. hard for the team to build fast — worth a one-line gut-check with the group (not necessarily reopening the decision, just making sure everyone clocked the tradeoff) since it affects how aggressive these latency/timeline requirements can realistically be for M1.
