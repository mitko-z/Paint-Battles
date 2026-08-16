import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { DrawingCanvas, type DrawingCanvasHandle } from "@/features/canvas/DrawingCanvas";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  getMatch,
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
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const countdown = useServerCountdown(match?.countdown_ends_at);
  const drawingClock = useServerCountdown(match?.drawing_ends_at);

  const refresh = useCallback(async () => {
    if (!id) return;
    const next = await getMatch(id);
    setMatch(next);
    if (next?.status === "results") {
      router.replace(`/results/${next.id}`);
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
      }
    });
    const poll = setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [id, refresh]);

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
      const submission = await submitDrawing(match.id, path);
      void submission;
      await refresh();
      const latest = await getMatch(match.id);
      if (latest?.status === "judging") {
        await requestJudgment(match.id);
        router.replace(`/results/${match.id}`);
      }
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
  useEffect(() => {
    if (!match) return;
    if (match.status === "submitting" || (match.status === "drawing" && drawingClock.isDone)) {
      void doSubmit();
    }
    if (match.status === "judging") {
      void requestJudgment(match.id)
        .then(() => router.replace(`/results/${match.id}`))
        .catch((e) => setError(e instanceof Error ? e.message : "Judging failed"));
    }
  }, [match?.status, drawingClock.isDone, doSubmit, match]);

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
              ? `Submitted — ${Math.max(drawingClock.remainingSec, 0)}s left for opponent`
              : `${Math.max(drawingClock.remainingSec, 0)}s`}
          </Text>
        ) : null}
        {match.status === "submitting" || submitting ? (
          <Text style={styles.timer}>Submitting…</Text>
        ) : null}
        {match.status === "judging" ? <Text style={styles.timer}>AI judging…</Text> : null}
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
              ? "Waiting for opponent’s drawing…"
              : match.status === "judging"
                ? "Scoring both sketches…"
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
