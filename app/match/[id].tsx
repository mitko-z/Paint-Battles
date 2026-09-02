import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { DrawingCanvas, type DrawingCanvasHandle } from "@/features/canvas/DrawingCanvas";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  forfeitMatch,
  getMatch,
  heartbeat,
  requestJudgment,
  submitDrawing,
  subscribeToMatch,
  uploadDrawingPng,
} from "@/features/match/api";
import { useServerCountdown } from "@/features/match/useServerCountdown";
import type { Match } from "@/lib/types";
import { colors, fonts } from "@/lib/theme";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function MatchScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = typeof rawId === "string" && UUID_RE.test(rawId) ? rawId : null;
  const { user } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const submittedRef = useRef(false);
  // Guards against calling requestJudgment more than once per mount of this
  // screen (2026-08-27 fix — see judge-match/index.ts's server-side claim
  // comment for the full incident). This ref alone can't stop a *different*
  // mount — a page reload, or app/results/[id].tsx's own mount effect —
  // from also calling requestJudgment for the same match; that cross-mount
  // case is what the server-side claim in judge-match/index.ts actually
  // fixes. This just stops the wasteful, redundant calls from *this* one.
  const judgeRequestedRef = useRef(false);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  // Root Cause A (forfeit/presence): event listeners below are attached
  // once (empty dep arrays) so they don't thrash on every match/status
  // change, so they read the latest match through a ref rather than a
  // stale closure. foregroundedRef gates heartbeats — see the AppState
  // effect further down.
  const matchRef = useRef<Match | null>(null);
  const foregroundedRef = useRef(true);

  const countdown = useServerCountdown(match?.countdown_ends_at);
  const drawingClock = useServerCountdown(match?.drawing_ends_at);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  const refresh = useCallback(async () => {
    if (!id) return;
    const next = await getMatch(id);
    setMatch(next);
    if (next?.status === "results") {
      router.replace(`/results/${next.id}`);
    } else if (next?.status === "cancelled") {
      // Both players gone, or a solo match abandoned before submitting —
      // nothing to show a result for (see the forfeit_and_presence
      // migration's _resolve_abandoned()). Reopening later already lands
      // here via lobby.tsx's own getMyActiveMatch() check; this just
      // covers the case where the screen is already open when it happens.
      router.replace("/lobby");
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setError("Invalid match link");
      router.replace("/lobby");
      return;
    }
    void refresh().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
    const unsub = subscribeToMatch(id, (next) => {
      setMatch(next);
      if (next.status === "results") {
        router.replace(`/results/${next.id}`);
      } else if (next.status === "cancelled") {
        router.replace("/lobby");
      }
    });
    // Proof-of-life ping, piggybacked on the poll this screen already
    // runs rather than a second timer. Skipped while backgrounded
    // (foregroundedRef) — an absent heartbeat, not an explicit signal,
    // is what the server-side presence sweep treats as "gone" after 10s.
    // Best-effort: a dropped heartbeat here and there is expected and
    // shouldn't interrupt drawing, so failures are swallowed.
    const sendHeartbeat = () => {
      if (foregroundedRef.current) void heartbeat(id).catch(() => {});
    };
    sendHeartbeat();
    const poll = setInterval(() => {
      void refresh();
      sendHeartbeat();
    }, 2000);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [id, refresh]);

  // Presence: heartbeats (above) only mean anything if we also stop sending
  // them the moment the app isn't actually in front of the player. AppState
  // covers both platforms here — react-native-web maps it to the Page
  // Visibility API, so this doesn't need a separate web-specific listener.
  // Deliberately not trying to distinguish "a deliberate background" from
  // "a fluke" — that judgment call is what the server-side grace window
  // (see the forfeit_and_presence migration) is for, not the client.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      foregroundedRef.current = state === "active";
    });
    return () => sub.remove();
  }, []);

  // Web only: resolve an explicit close (tab close, refresh, navigating
  // away) immediately rather than waiting out the presence grace above —
  // see forfeitMatch()'s own comment for why this needs a raw
  // fetch(keepalive) rather than supabase-js's normal client. There's no
  // native equivalent of `pagehide`/`beforeunload` — a killed app doesn't
  // get a chance to run JS, so native relies entirely on the AppState +
  // presence-sweep path above (see item 1.1's warning banner in the JSX
  // below, which covers both platforms since a mobile OS won't let JS
  // block backgrounding with a confirm dialog the way beforeunload can).
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const stillLive = (m: Match | null): m is Match =>
      !!m && m.status !== "results" && m.status !== "cancelled";

    const onPageHide = () => {
      const current = matchRef.current;
      if (!stillLive(current) || submittedRef.current) return;
      void forfeitMatch(current.id);
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const current = matchRef.current;
      if (!current || current.status !== "drawing" || submittedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  // Advance phases when local timer hits zero
  useEffect(() => {
    if (!match) return;
    if (match.status === "countdown" && countdown.isDone) {
      void refresh();
    }
    if (match.status === "drawing" && drawingClock.isDone) {
      void refresh();
    }
  }, [match, countdown.isDone, drawingClock.isDone, refresh]);

  const doSubmit = useCallback(async () => {
    if (!match || !user || submittedRef.current) return;
    submittedRef.current = true;
    setHasSubmitted(true);
    setSubmitting(true);
    setError(null);
    try {
      const base64 = await canvasRef.current?.exportPngBase64();
      if (!base64) throw new Error("Could not capture drawing");
      const path = await uploadDrawingPng(user.id, match.id, base64);
      // shouldRequestJudging comes from submit_drawing()'s own atomic claim
      // (2026-08-27 — see supabase/migrations/20260827090000_*.sql): the
      // row lock it already takes means at most one of the two players'
      // submit_drawing() calls can ever get true, so at most one client
      // ever calls requestJudgment for a given match. No client-side
      // "who saw status === judging first" race to get wrong anymore.
      const { shouldRequestJudging } = await submitDrawing(match.id, path);
      await refresh();
      if (shouldRequestJudging && !judgeRequestedRef.current) {
        judgeRequestedRef.current = true;
        await requestJudgment(match.id);
        router.replace(`/results/${match.id}`);
      }
      // If shouldRequestJudging is false, this client is the one who
      // submitted first — it just waits. The poll/realtime effect above
      // already routes to /results as soon as status flips there.
    } catch (e) {
      submittedRef.current = false;
      setHasSubmitted(false);
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }, [match, user, refresh]);

  // Auto-submit only after the shared timer ends (or match is in submitting).
  // Early Submit from one client must not force the other to submit.
  //
  // requestJudgment is deliberately NOT called from here anymore
  // (2026-08-27 — see Incident 5 in the project doc / the submit_drawing
  // migration comment). This effect used to also call requestJudgment
  // whenever match.status === "judging", but "does this client currently
  // observe status === judging" isn't an atomic signal — both players'
  // clients can observe it at effectively the same moment, so both could
  // call requestJudgment for the same match. That's now decided once,
  // atomically, inside submit_drawing() itself (via its existing row lock)
  // and surfaced to doSubmit() below as shouldRequestJudging — only that
  // one path ever calls requestJudgment. This effect now only handles
  // auto-submit; waiting for the result happens via the poll/realtime
  // effect above, which already routes to /results once status gets there.
  useEffect(() => {
    if (!match) return;
    if (match.status === "submitting" || (match.status === "drawing" && drawingClock.isDone)) {
      void doSubmit();
    }
  }, [match?.status, drawingClock.isDone, doSubmit]);

  if (!match) {
    return (
      <Screen>
        <Text style={styles.meta}>Loading match…</Text>
        <ErrorText message={error} />
      </Screen>
    );
  }

  const drawingOpen = match.status === "drawing" && !hasSubmitted;
  const showCanvas = match.status === "countdown" || match.status === "drawing";

  return (
    <Screen style={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.promptLabel}>Draw</Text>
        <Text style={styles.prompt}>{match.prompt}</Text>
        {match.status === "countdown" ? (
          <Text style={styles.timer}>Starting in {Math.max(countdown.remainingSec, 0)}</Text>
        ) : null}
        {match.status === "drawing" ? (
          <Text style={styles.timer}>
            {hasSubmitted
              ? match.is_solo
                ? "Submitted!"
                : `Submitted — ${Math.max(drawingClock.remainingSec, 0)}s left for opponent`
              : `${Math.max(drawingClock.remainingSec, 0)}s`}
          </Text>
        ) : null}
        {match.status === "submitting" || submitting ? (
          <Text style={styles.timer}>Submitting…</Text>
        ) : null}
        {match.status === "judging" ? <Text style={styles.timer}>AI judging…</Text> : null}
        {match.status === "drawing" && !hasSubmitted ? (
          <Text style={styles.closeWarning}>Leaving now forfeits this round.</Text>
        ) : null}
      </View>

      {showCanvas ? (
        <>
          <View style={styles.canvasWrap}>
            <DrawingCanvas ref={canvasRef} tool={tool} disabled={!drawingOpen || submitting} />
          </View>
          <View style={styles.tools}>
            <PrimaryButton
              label="Pen"
              style={styles.toolBtn}
              variant={tool === "pen" ? "primary" : "secondary"}
              onPress={() => setTool("pen")}
            />
            <PrimaryButton
              label="Eraser"
              style={styles.toolBtn}
              variant={tool === "eraser" ? "primary" : "secondary"}
              onPress={() => setTool("eraser")}
            />
            <PrimaryButton
              label={hasSubmitted ? "Submitted" : "Submit"}
              style={styles.toolBtn}
              disabled={!drawingOpen || submitting}
              loading={submitting}
              onPress={() => void doSubmit()}
            />
          </View>
        </>
      ) : (
        <View style={styles.waitBox}>
          <Text style={styles.waitText}>
            {match.status === "submitting"
              ? match.is_solo
                ? "Submitting your drawing…"
                : "Waiting for opponent’s drawing…"
              : match.status === "judging"
                ? match.is_solo
                  ? "Scoring your sketch…"
                  : "Scoring both sketches…"
                : "Hold tight…"}
          </Text>
        </View>
      )}
      <ErrorText message={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: 48,
  },
  top: {
    marginBottom: 12,
  },
  promptLabel: {
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: "700",
  },
  prompt: {
    fontFamily: fonts.display,
    fontSize: 36,
    color: colors.ink,
    marginTop: 4,
  },
  timer: {
    marginTop: 6,
    fontSize: 22,
    fontWeight: "800",
    color: colors.accentDark,
  },
  closeWarning: {
    marginTop: 6,
    fontSize: 13,
    color: colors.danger,
  },
  canvasWrap: {
    flex: 1,
    minHeight: 280,
  },
  tools: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  toolBtn: {
    flex: 1,
    paddingHorizontal: 8,
  },
  meta: {
    color: colors.inkMuted,
  },
  waitBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  waitText: {
    fontSize: 18,
    color: colors.inkMuted,
    textAlign: "center",
  },
});
