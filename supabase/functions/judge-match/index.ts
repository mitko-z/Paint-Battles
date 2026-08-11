import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type JudgePayload = {
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | "draw";
  rationaleA?: string;
  rationaleB?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const started = Date.now();

  try {
    const { matchId } = await req.json();
    if (!matchId) {
      return json({ error: "matchId required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

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

    await admin.from("matches").update({ status: "judging" }).eq("id", matchId);

    const subA = submissions.find((s) => s.user_id === match.player_a)!;
    const subB = submissions.find((s) => s.user_id === match.player_b)!;

    const urlA = admin.storage.from("drawings").getPublicUrl(subA.storage_path).data.publicUrl;
    const urlB = admin.storage.from("drawings").getPublicUrl(subB.storage_path).data.publicUrl;

    const judgment = openaiKey
      ? await judgeWithOpenAI(openaiKey, match.prompt, urlA, urlB)
      : heuristicJudge(match.prompt);

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

function heuristicJudge(prompt: string): JudgePayload {
  // Offline / missing API key: deterministic placeholder for local demos
  const seed = prompt.length % 2;
  return {
    scoreA: seed === 0 ? 72 : 68,
    scoreB: seed === 0 ? 65 : 74,
    winner: seed === 0 ? "A" : "B",
    rationaleA: "Heuristic score (set OPENAI_API_KEY for real judging).",
    rationaleB: "Heuristic score (set OPENAI_API_KEY for real judging).",
  };
}

async function judgeWithOpenAI(
  apiKey: string,
  prompt: string,
  imageAUrl: string,
  imageBUrl: string,
): Promise<JudgePayload> {
  const system = `You are a fair judge for a 1-minute doodle contest.
Score how well each sketch depicts the prompt subject — NOT artistic skill.
Return ONLY compact JSON:
{"scoreA":0-100,"scoreB":0-100,"winner":"A"|"B"|"draw","rationaleA":"short","rationaleB":"short"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: `Prompt to draw: "${prompt}". Image A then Image B.` },
            { type: "image_url", image_url: { url: imageAUrl, detail: "low" } },
            { type: "image_url", image_url: { url: imageBUrl, detail: "low" } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty OpenAI response");
  }

  const parsed = JSON.parse(content) as JudgePayload;
  parsed.scoreA = clampScore(parsed.scoreA);
  parsed.scoreB = clampScore(parsed.scoreB);
  if (!["A", "B", "draw"].includes(parsed.winner)) {
    parsed.winner =
      parsed.scoreA === parsed.scoreB ? "draw" : parsed.scoreA > parsed.scoreB ? "A" : "B";
  }
  return parsed;
}

function clampScore(n: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}
