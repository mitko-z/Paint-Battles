import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createGeminiJudge, type JudgeLogRecord } from "./geminiJudge.ts";
import type { VisionJudgeResult } from "../../../src/lib/vision/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { matchId } = await req.json();
    if (!matchId) {
      return json({ error: "matchId required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Server-side only. Never expose this via EXPO_PUBLIC_* — see docs/DEPLOY.md.
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: match, error: matchError } = await admin
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      return json({ error: "Match not found" }, 404);
    }

    if (match.player_a !== userData.user.id && match.player_b !== userData.user.id) {
      return json({ error: "Forbidden" }, 403);
    }

    if (match.status === "results") {
      return json({ match, alreadyJudged: true });
    }

    if (match.status !== "judging" && match.status !== "submitting") {
      return json({ error: `Match status is ${match.status}` }, 409);
    }

    const { data: submissions, error: subError } = await admin
      .from("match_submissions")
      .select("*")
      .eq("match_id", matchId);

    if (subError || !submissions || submissions.length < 2) {
      return json({ error: "Both submissions required" }, 409);
    }

    // NOTE (2026-08-27): a same-day attempt at an atomic "claim" here (CAS
    // on status: 'submitting' -> 'judging') was WRONG and got reverted —
    // submit_drawing() (supabase/migrations/20260312000000_early_submit_wait.sql)
    // already flips matches.status straight to 'judging' itself, server-side,
    // the moment both submissions land, *before* this function is ever
    // called. So by the time we get here, status is always already
    // "judging", never "submitting" — a CAS on "submitting" can never
    // succeed, which made every real call fall through to "wait for a
    // result that will never come" and permanently froze every match on
    // "Scoring both sketches…". Reverted to the simple unconditional update
    // below. Duplicate concurrent calls for the same match (the actual
    // quota-burning bug from the incident this comment used to describe)
    // are now handled client-side instead — see the judgeRequestedRef guard
    // and the dependency-array fix in app/match/[id].tsx. That doesn't
    // close the rare case of two players' browsers both racing to call this
    // at the same instant, but the cost of that is one wasted duplicate
    // Gemini call, not a stuck match — a real server-side claim would need
    // a piece of state this function can check that ISN'T already flipped
    // by the RPC before we get here (e.g. a small dedicated lock table),
    // which is a schema change worth doing deliberately, not as a quick
    // patch — flag if that rare race turns out to matter in practice.
    await admin.from("matches").update({ status: "judging" }).eq("id", matchId);

    // R3.1: "scoring latency" clock starts here — this is the earliest
    // point the server can confirm both drawings are actually in. (It
    // doesn't capture matchmaking/auth overhead above, which is
    // deliberate: those aren't Vision-scoring latency. It also doesn't
    // capture realtime propagation back to both clients after we
    // return — that's a separate client-side measurement if the team
    // wants the full submit→both-clients-see-result number from R3.1's
    // definition.)
    const started = Date.now();

    const subA = submissions.find((s) => s.user_id === match.player_a)!;
    const subB = submissions.find((s) => s.user_id === match.player_b)!;

    const urlA = admin.storage.from("drawings").getPublicUrl(subA.storage_path).data.publicUrl;
    const urlB = admin.storage.from("drawings").getPublicUrl(subB.storage_path).data.publicUrl;

    // Structured per-match log line (R§5 instrumentation) — deliberately
    // NOT a DB column: the team decided the 100-match beta metric can be
    // counted manually / from these Edge Function logs rather than take
    // on a schema change for it. Filter Edge Function logs for
    // `"event":"judge_result"` to see outcome/attempts/latency per match.
    const logJudgment = (record: JudgeLogRecord) => {
      console.log(JSON.stringify({ event: "judge_result", ...record }));
    };

    let judgment: VisionJudgeResult;
    if (geminiKey) {
      judgment = await createGeminiJudge(geminiKey, matchId, logJudgment, heuristicJudge).score({
        prompt: match.prompt,
        imageAUrl: urlA,
        imageBUrl: urlB,
      });
    } else {
      // This branch never touches geminiJudge.ts, so log it here — otherwise
      // "AI judging unavailable" would show up with nothing in the Edge
      // Function logs explaining why (this was a real gap: first-time
      // testing with no GEMINI_API_KEY secret set produced no log at all).
      logJudgment({
        matchId,
        provider: "gemini",
        model: "n/a",
        outcome: "no_api_key",
        attempts: 0,
        latencyMs: 0,
        error: "GEMINI_API_KEY is not set — check `supabase secrets list`",
      });
      judgment = heuristicJudge(match.prompt, "GEMINI_API_KEY not set");
    }

    const winnerId =
      judgment.winner === "A"
        ? match.player_a
        : judgment.winner === "B"
          ? match.player_b
          : null;

    await admin
      .from("match_submissions")
      .update({ score: judgment.scoreA, rationale: judgment.rationaleA ?? null })
      .eq("id", subA.id);

    await admin
      .from("match_submissions")
      .update({ score: judgment.scoreB, rationale: judgment.rationaleB ?? null })
      .eq("id", subB.id);

    const latency = Date.now() - started;

    const { data: updatedMatch, error: updateError } = await admin
      .from("matches")
      .update({
        status: "results",
        winner_id: winnerId,
        is_draw: judgment.winner === "draw",
        judge_latency_ms: latency,
      })
      .eq("id", matchId)
      .select("*")
      .single();

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    if (winnerId) {
      const loserId = winnerId === match.player_a ? match.player_b : match.player_a;
      const { data: winnerProfile } = await admin
        .from("profiles")
        .select("wins")
        .eq("id", winnerId)
        .single();
      const { data: loserProfile } = await admin
        .from("profiles")
        .select("losses")
        .eq("id", loserId)
        .single();

      if (winnerProfile) {
        await admin
          .from("profiles")
          .update({ wins: (winnerProfile.wins ?? 0) + 1 })
          .eq("id", winnerId);
      }
      if (loserProfile) {
        await admin
          .from("profiles")
          .update({ losses: (loserProfile.losses ?? 0) + 1 })
          .eq("id", loserId);
      }
    }

    return json({ match: updatedMatch, judgment, latencyMs: latency });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function heuristicJudge(prompt: string, reason = "no GEMINI_API_KEY configured"): VisionJudgeResult {
  // Offline / no real AI judging available: deterministic placeholder.
  // `reason` is embedded directly in the rationale (persisted to the
  // existing match_submissions.rationale column, no schema change) so
  // it's visible in-app on the results screen — see app/results/[id].tsx.
  const seed = prompt.length % 2;
  return {
    scoreA: seed === 0 ? 72 : 68,
    scoreB: seed === 0 ? 65 : 74,
    winner: seed === 0 ? "A" : "B",
    rationaleA: `AI judging unavailable (${reason}) — used backup scorer.`,
    rationaleB: `AI judging unavailable (${reason}) — used backup scorer.`,
  };
}
