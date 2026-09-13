// Gemini Vision judge — implements the shared VisionJudge contract
// (src/lib/vision/types.ts) via a direct REST call to Gemini's
// generateContent endpoint.
//
// This imports src/lib/vision/types.ts directly (across the
// supabase/functions/ boundary) rather than duplicating the shapes
// locally. That requires deploying with `supabase functions deploy
// judge-match --use-api` — see docs/DEPLOY.md for what that flag does
// and its caveats. Team call: no duplicate copy to maintain; if the
// cross-import ever becomes a problem, the old duplicated-types version
// is in git history.
//
// Why raw fetch() instead of the @google/genai SDK:
//   - The existing OpenAI judge in this codebase already talks to its
//     provider via fetch(), not an SDK. Matching that keeps the two
//     judges symmetric and avoids introducing an npm: import (extra
//     bundle weight, one more thing that can break in the Deno edge
//     runtime) for what is a single stateless HTTP call.
//   - generateContent is Google's stable, fully-documented REST
//     endpoint. There's a newer "Interactions API" (GA'd 2026-08-13)
//     that Google now recommends by default, but it's built around
//     multi-turn sessions (`store=true` unless you opt out) — real
//     capability we don't need for a one-shot "score these two
//     images" call. generateContent has no deprecation notice as of
//     this writing. If the team wants to revisit, this is the one
//     module that would need to change (that's the point of the
//     VisionJudge seam).
//
// Why fetch-and-inline instead of passing the Supabase Storage URL:
//   - Unlike OpenAI's `image_url`, Gemini's generateContent does not
//     accept an image URL. It needs either inline base64 bytes
//     (`inline_data`, capped around 20MB per request total) or a
//     prior Files API upload. Drawings here are small PNGs from a
//     60s canvas, so inline is simplest and avoids a second Google
//     API round trip.
//
// Model ID: IDs shift fast on this API — re-check the AI Studio model
// picker before shipping. Currently gemini-3.5-flash (switched here
// 2026-08-27 after 3.6-flash/3.7-flash/3.5-flash-lite each hit
// free-tier RPM the same day during testing — see the project doc's
// Incident 3, that RPM burn was a duplicate-request bug, not these
// models being bad).
//
// Free-tier limits (as reported from the AI Studio rate-limit page for
// this model, 2026-08-25): RPM 5, TPM 250K, RPD 20. RPD 20 in
// particular is tight — 1 match = 1 request, so ~20 judged matches/day
// before every subsequent match falls back to the heuristic judge below
// (see "rate_limited" outcome). Worth checking whether that's enough
// headroom for the "100 matches" beta target, or whether it needs to
// span several days / a higher tier / a different model.
//
// scoreSolo() (single-player mode, added 2026-09-01): same endpoint,
// model, timeout/retry/rate-limit handling as the 1v1 score() path —
// it just sends one image and asks for a single 0-100 score instead of
// a head-to-head comparison. Deliberately NOT implemented as
// score(input, input) (comparing an image against itself) — that would
// burn a second inline image in the request for no reason and the
// head-to-head prompt wording ("Image A then Image B... winner") makes
// no sense for one drawing.
import type {
  VisionJudge,
  VisionJudgeInput,
  VisionJudgeResult,
  VisionSoloJudgeInput,
  VisionSoloJudgeResult,
} from "../../../src/lib/vision/types.ts";

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// TEMPORARILY WIDENED FOR TESTING (2026-08-27, explicit ask — "let's extend
// this timeout to a bigger value, e.g. 30 seconds - I want to test the
// model's behavior properly"). R3.2's real target is <3s round trip, R3.3's
// hard ceiling is 8s total — these values are well above that on purpose,
// to see how Gemini actually behaves (slow API? consistently >3.5s?
// something else?) instead of cutting it off before it can answer. Dial
// back toward PER_ATTEMPT_TIMEOUT_MS ~3-4s / HARD_CEILING_MS ~8s once
// that's understood and R3.2/R3.3 are being held for real, not just tested
// against.
const PER_ATTEMPT_TIMEOUT_MS = 30_000;
// Two attempts at 30s each, plus overhead — set well above 2x
// PER_ATTEMPT_TIMEOUT_MS so a slow-but-real response is never cut off by
// this ceiling before PER_ATTEMPT_TIMEOUT_MS itself would time it out.
const HARD_CEILING_MS = 65_000;
// R3.4: one retry on error/timeout, no more (avoid compounding latency).
// Does NOT apply to a rate-limit hit — see below.
const MAX_ATTEMPTS = 2;

export type JudgeOutcome = "scored" | "timeout" | "error_fallback" | "rate_limited" | "no_api_key";

export type JudgeLogRecord = {
  matchId: string;
  provider: "gemini";
  model: string;
  outcome: JudgeOutcome;
  attempts: number;
  latencyMs: number;
  error?: string;
};

class GeminiTimeoutError extends Error {}
class GeminiRateLimitError extends Error {}

/**
 * Builds a VisionJudge backed by Gemini. `onLog` is called exactly once
 * per score()/scoreSolo() call with a structured record — R§5 requires
 * every match to produce a structured log so the "100 matches, no
 * desync" beta metric is actually countable, not eyeballed.
 *
 * `heuristicFallback` is what we hand back when the free-tier quota is
 * exhausted (HTTP 429) for a 1v1 match. Team decision: a quota hit is
 * not the same situation as a genuine timeout/error (R3.3's "declare a
 * draw") — it's an expected, foreseeable state on the free tier, so it
 * degrades to the same non-AI heuristic judge used when no API key is
 * configured at all, rather than drawing every match until the quota
 * resets.
 *
 * `heuristicSoloFallback` is the single-player equivalent, used both
 * for solo quota hits and for any solo timeout/error — a solo match has
 * no opponent to "draw" against, so every solo failure mode degrades to
 * the same deterministic backup scorer rather than a special-cased
 * outcome.
 *
 * Debugging note: rather than a generic "AI unavailable" message, both
 * fallback paths embed a short reason straight into the rationale text
 * that's already persisted to `match_submissions.rationale` (existing
 * column, no schema change) — that's what shows up in-app on the
 * results screen. The FULL error (untruncated further than here) still
 * goes to `onLog` for the Edge Function logs; what lands in the
 * rationale is capped short (~140 chars) since players see it too.
 */
export function createGeminiJudge(
  apiKey: string,
  matchId: string,
  onLog: (record: JudgeLogRecord) => void,
  heuristicFallback: (prompt: string, reason: string) => VisionJudgeResult,
  heuristicSoloFallback: (prompt: string, reason: string) => VisionSoloJudgeResult,
): VisionJudge {
  const shortReason = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
  };

  return {
    async score(input: VisionJudgeInput): Promise<VisionJudgeResult> {
      const started = Date.now();
      const deadline = started + HARD_CEILING_MS;

      const finish = (
        err: unknown,
        outcome: JudgeOutcome,
        attemptsMade: number,
        result: VisionJudgeResult,
      ): VisionJudgeResult => {
        const message = err instanceof Error ? err.message : String(err);
        onLog({
          matchId,
          provider: "gemini",
          model: GEMINI_MODEL,
          outcome,
          attempts: attemptsMade,
          latencyMs: Date.now() - started,
          error: outcome === "scored" ? undefined : message,
        });
        return result;
      };

      const drawFallback = (err: unknown): VisionJudgeResult => {
        const reason = shortReason(err);
        return {
          scoreA: 0,
          scoreB: 0,
          winner: "draw",
          rationaleA: `AI judging failed (${reason}) — match declared a draw.`,
          rationaleB: `AI judging failed (${reason}) — match declared a draw.`,
        };
      };

      // Fetch + base64-encode both drawings once — they don't change
      // between retries, only the model call is worth repeating.
      let imageA: InlineImage;
      let imageB: InlineImage;
      try {
        [imageA, imageB] = await Promise.all([
          fetchAsInlineData(input.imageAUrl),
          fetchAsInlineData(input.imageBUrl),
        ]);
      } catch (err) {
        return finish(err, "error_fallback", 0, drawFallback(err));
      }

      let lastError: unknown =
        new GeminiTimeoutError("No time left in the 8s scoring budget");
      let attemptsMade = 0;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        attemptsMade = attempt;
        try {
          const result = await callGemini(
            apiKey,
            input.prompt,
            imageA,
            imageB,
            Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining),
          );
          return finish(undefined, "scored", attempt, result);
        } catch (err) {
          lastError = err;
          if (err instanceof GeminiRateLimitError) break; // retrying now won't help — same RPM window
        }
      }

      if (lastError instanceof GeminiRateLimitError) {
        return finish(
          lastError,
          "rate_limited",
          attemptsMade,
          heuristicFallback(input.prompt, shortReason(lastError)),
        );
      }

      const outcome: JudgeOutcome = lastError instanceof GeminiTimeoutError
        ? "timeout"
        : "error_fallback";
      return finish(lastError, outcome, attemptsMade, drawFallback(lastError));
    },

    async scoreSolo(input: VisionSoloJudgeInput): Promise<VisionSoloJudgeResult> {
      const started = Date.now();
      const deadline = started + HARD_CEILING_MS;

      const finish = (
        err: unknown,
        outcome: JudgeOutcome,
        attemptsMade: number,
        result: VisionSoloJudgeResult,
      ): VisionSoloJudgeResult => {
        const message = err instanceof Error ? err.message : String(err);
        onLog({
          matchId,
          provider: "gemini",
          model: GEMINI_MODEL,
          outcome,
          attempts: attemptsMade,
          latencyMs: Date.now() - started,
          error: outcome === "scored" ? undefined : message,
        });
        return result;
      };

      let image: InlineImage;
      try {
        image = await fetchAsInlineData(input.imageUrl);
      } catch (err) {
        return finish(err, "error_fallback", 0, heuristicSoloFallback(input.prompt, shortReason(err)));
      }

      let lastError: unknown =
        new GeminiTimeoutError("No time left in the 8s scoring budget");
      let attemptsMade = 0;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        attemptsMade = attempt;
        try {
          const result = await callGeminiSolo(
            apiKey,
            input.prompt,
            image,
            Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining),
          );
          return finish(undefined, "scored", attempt, result);
        } catch (err) {
          lastError = err;
          if (err instanceof GeminiRateLimitError) break; // retrying now won't help — same RPM window
        }
      }

      // Unlike the 1v1 path, a solo match has no opponent to "draw"
      // against on failure — every failure mode (rate limit, timeout,
      // error) degrades to the same deterministic backup scorer used
      // when no API key is configured at all.
      const outcome: JudgeOutcome = lastError instanceof GeminiRateLimitError
        ? "rate_limited"
        : lastError instanceof GeminiTimeoutError
          ? "timeout"
          : "error_fallback";
      return finish(
        lastError,
        outcome,
        attemptsMade,
        heuristicSoloFallback(input.prompt, shortReason(lastError)),
      );
    },
  };
}

type InlineImage = { base64: string; mimeType: string };

/**
 * Create a specific system prompt based on if used for single or for two images
 */
const buildSystemPrompt = (areTwoSketches: boolean): string => {
  let jsonFormat = areTwoSketches ? 
               '{"scoreA":0-100,"scoreB":0-100,"winner":"A"|"B"|"draw","rationaleA":"short","rationaleB":"short"}' :
               '{"score":0-100,"rationale":"short"}';
  return `You are a strict, skeptical art critic judging a 60-second speed-drawing contest. Players may only use a pen (black line) and an eraser -- no color, no fill.

Score how well ${areTwoSketches ? "each" : "this"} sketch depicts the prompt subject, from 0 to 100. Recognizing the subject is necessary but NOT sufficient for a high score -- most sketches that merely "look like the thing" belong in the 30-60 range. Scores of 90+ must be rare and reserved for drawings that show real skill within the time/tool constraints.

Anchor your score to these bands (do not default to the top of a band):
- 0-9: blank, scribble, or unrelated to the prompt.
- 10-29: a few disconnected lines or shapes that only vaguely gesture at the subject; a viewer would have to guess.
- 30-49: recognizable but drawn with generic, childlike shapes -- no attention to proportion, perspective, or detail specific to the prompt.
- 50-69: clearly recognizable, correct basic proportions, and at least one detail specific to this prompt (not a generic stand-in shape) -- but still flat, with little shading or depth.
- 70-89: accurate proportions and shape, several distinguishing details, and some shading/hatching/perspective used to suggest form or depth -- clearly drawn with care, not just speed.
- 90-100: exceptional given the 60-second, pen-only constraint: accurate proportions AND perspective/dimensionality AND deliberate shading or texture AND multiple correct, specific details. This band should be uncommon.

Judge on: accuracy to the specific prompt (not just the general category), correctness of proportion and shape, amount of detail versus what a rushed sketch usually contains, and any skillful use of line weight, hatching, or perspective (line and erasing are the only tools available, so reward skillful use of them specifically). Be skeptical of a sketch that is only recognizable because you already know the prompt -- ask whether it would stand on its own without that hint.
${areTwoSketches ? "Score each sketch independently against this rubric before comparing them. Do not inflate one sketch's absolute score just because it beats the other -- two weak sketches can both score in the 30-50 range with a winner still declared." : ""}
In the rationale, name the specific reason the score wasn't higher (missing detail, proportion issue, lack of shading, etc.) rather than only confirming the subject is recognizable.

Return ONLY compact JSON, no markdown fences:
${jsonFormat}`;
};

async function callGemini(
  apiKey: string,
  prompt: string,
  imageA: InlineImage,
  imageB: InlineImage,
  timeoutMs: number,
): Promise<VisionJudgeResult> {
  const system = buildSystemPrompt(true);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: `${system}\n\nPrompt to draw: "${prompt}". Image A then Image B.` },
              { inline_data: { mime_type: imageA.mimeType, data: imageA.base64 } },
              { inline_data: { mime_type: imageB.mimeType, data: imageB.base64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });
  } catch (err) {
    if (timedOut) throw new GeminiTimeoutError(`Gemini call exceeded ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const text = await res.text();
    throw new GeminiRateLimitError(`Gemini rate limit: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error: ${res.status} ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    // Most common causes: the prompt or an image tripped Gemini's safety
    // filters (promptFeedback.blockReason), or the candidate stopped for
    // a reason other than completing normally (finishReason). Surface
    // whichever is present instead of a bare "empty response".
    const blockReason = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(
      `Empty Gemini response (blockReason=${blockReason ?? "none"}, finishReason=${finishReason ?? "none"})`,
    );
  }

  let parsed: VisionJudgeResult;
  try {
    parsed = JSON.parse(content) as VisionJudgeResult;
  } catch {
    throw new Error(`Gemini response wasn't valid JSON: ${content.slice(0, 200)}`);
  }
  parsed.scoreA = clampScore(parsed.scoreA);
  parsed.scoreB = clampScore(parsed.scoreB);
  if (!["A", "B", "draw"].includes(parsed.winner)) {
    parsed.winner = parsed.scoreA === parsed.scoreB ? "draw" : parsed.scoreA > parsed.scoreB ? "A" : "B";
  }
  return parsed;
}

async function callGeminiSolo(
  apiKey: string,
  prompt: string,
  image: InlineImage,
  timeoutMs: number,
): Promise<VisionSoloJudgeResult> {
  const system = buildSystemPrompt(false);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: `${system}\n\nPrompt to draw: "${prompt}".` },
              { inline_data: { mime_type: image.mimeType, data: image.base64 } },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    });
  } catch (err) {
    if (timedOut) throw new GeminiTimeoutError(`Gemini call exceeded ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const text = await res.text();
    throw new GeminiRateLimitError(`Gemini rate limit: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error: ${res.status} ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    const blockReason = data?.promptFeedback?.blockReason;
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(
      `Empty Gemini response (blockReason=${blockReason ?? "none"}, finishReason=${finishReason ?? "none"})`,
    );
  }

  let parsed: VisionSoloJudgeResult;
  try {
    parsed = JSON.parse(content) as VisionSoloJudgeResult;
  } catch {
    throw new Error(`Gemini response wasn't valid JSON: ${content.slice(0, 200)}`);
  }
  parsed.score = clampScore(parsed.score);
  return parsed;
}

async function fetchAsInlineData(url: string): Promise<InlineImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch drawing (${res.status}) from ${url}`);
  const mimeType = res.headers.get("content-type") ?? "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { base64: bytesToBase64(bytes), mimeType };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // avoid blowing the call stack on String.fromCharCode(...bigArray)
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function clampScore(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}
