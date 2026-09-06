import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { DripText, ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { getMatch, getSubmissions, requestJudgment } from "@/features/match/api";
import { supabase } from "@/lib/supabase";
import type { Match, MatchSubmission } from "@/lib/types";
import { colors, fonts } from "@/lib/theme";
import { useAudioPlayer } from "expo-audio";

// Result cue sounds - preloaded up front (useAudioPlayer() starts loading its source
// as soon as it is called) the same way app/match/[id].tsx preloads its cues, so
// playback is instant once the outcome is known.
const winAudio = require("../../assets/you win.mp3");
const loseAudio = require("../../assets/you lose.mp3");

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, refreshProfile } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [subs, setSubs] = useState<MatchSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const winPlayer = useAudioPlayer(winAudio);
  const losePlayer = useAudioPlayer(loseAudio);
  // One-shot guard so the win/lose cue fires exactly once per mount, the moment the
  // result is known - same pattern as the countdown/tick/whistle cues in
  // app/match/[id].tsx. This screen never re-renders a different match in place (a
  // rematch routes through a fresh /results/[id] mount), so there's no reset case to
  // handle here.
  const resultCueFiredRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        let m = await getMatch(id);
        if (m && (m.status === "judging" || m.status === "submitting")) {
          await requestJudgment(id);
          m = await getMatch(id);
        }
        setMatch(m);
        const submissions = await getSubmissions(id);
        setSubs(submissions);
        await refreshProfile();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load results");
      }
    })();
  }, [id, refreshProfile]);

  // Win/lose cue: fires once the result is known. Skipped for a draw (neither win nor
  // lose) and for a solo match (no opponent to beat, hence the 'Nice sketch!' outcome).
  useEffect(() => {
    if (!match || !user || match.status !== "results" || resultCueFiredRef.current) return;
    if (match.is_solo || match.is_draw) return;
    resultCueFiredRef.current = true;
    if (match.winner_id === user.id) {
      winPlayer.seekTo(0);
      winPlayer.play();
    } else {
      losePlayer.seekTo(0);
      losePlayer.play();
    }
  }, [match, user, winPlayer, losePlayer]);

  const mySub = subs.find((s) => s.user_id === user?.id);
  const oppSub = subs.find((s) => s.user_id !== user?.id);

  const publicUrl = (path?: string | null) => {
    if (!path) return null;
    return supabase.storage.from("drawings").getPublicUrl(path).data.publicUrl;
  };

  const outcome =
    !match || !user
      ? ""
      : match.is_solo
        ? "Nice sketch!"
        : match.is_draw
          ? "Draw"
          : match.winner_id === user.id
            ? "You win"
            : "You lose";

  // No judge_outcome column (team chose to skip that schema change) — so
  // this is inferred from the rationale text the judge already writes to
  // match_submissions, which was persisted either way. Both fallback
  // paths (supabase/functions/judge-match/geminiJudge.ts and
  // index.ts's heuristicJudge()) prefix their rationale with "AI judging"
  // and embed the actual reason (missing key, rate limit, timeout, HTTP
  // status, etc.) right in the text — shown as-is here for debugging.
  // Fragile in the "literal prefix has to stay in sync" sense; update
  // the check below if that wording changes.
  const judgeNotice = [mySub?.rationale, oppSub?.rationale].find((r) =>
    r?.startsWith("AI judging"),
  );

  // Root Cause A: a forfeited match never went through AI judging, so
  // there's no score/rationale to show for whichever side left — say so
  // plainly instead of letting the score cards render as unexplained
  // blanks. Solo matches can't forfeit (an abandoned solo match ends in
  // 'cancelled', not 'results' — see the forfeit_and_presence
  // migration), so this only ever applies to a real 1v1 outcome.
  const forfeitNotice =
    match?.end_reason === "forfeit"
      ? match.winner_id === user?.id
        ? "Your opponent left the match — you win by forfeit."
        : "You left the match, so this round is recorded as a loss."
      : null;

  return (
    <Screen>
      <DripText style={styles.title} containerStyle={styles.titleStack}>
        {outcome || "Results"}
      </DripText>
      <Text style={styles.prompt}>Prompt: {match?.prompt ?? "…"}</Text>
      {match?.judge_latency_ms != null ? (
        <Text style={styles.meta}>Judged in {match.judge_latency_ms}ms</Text>
      ) : null}
      {forfeitNotice ? (
        <Text style={styles.notice}>{forfeitNotice}</Text>
      ) : judgeNotice ? (
        <Text style={styles.notice}>{judgeNotice}</Text>
      ) : null}

      <View style={styles.row}>
        <ResultCard
          label="You"
          score={mySub?.score}
          rationale={mySub?.rationale}
          uri={publicUrl(mySub?.storage_path)}
          tilt="left"
        />
        {match?.is_solo ? null : (
          <ResultCard
            label="Opponent"
            score={oppSub?.score}
            rationale={oppSub?.rationale}
            uri={publicUrl(oppSub?.storage_path)}
            tilt="right"
          />
        )}
      </View>

      <ErrorText message={error} />
      <PrimaryButton label="Play again" onPress={() => router.replace("/lobby")} />
    </Screen>
  );
}

function ResultCard({
  label,
  score,
  rationale,
  uri,
  tilt,
}: {
  label: string;
  score?: number | null;
  rationale?: string | null;
  uri?: string | null;
  tilt: "left" | "right";
}) {
  return (
    <View style={[styles.card, tilt === "left" ? styles.cardTiltLeft : styles.cardTiltRight]}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.score}>{score != null ? Math.round(score) : "—"}</Text>
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.thumb}
          resizeMode="contain"
          onError={(e) =>
            console.warn(`[results] failed to load ${label} image:`, e.nativeEvent.error, uri)
          }
        />
      ) : null}
      {rationale ? <Text style={styles.rationale}>{rationale}</Text> : null}
    </View>
  );
}

// The two score cards are styled as torn paper tickets pinned up after the fight -
// a light, warm parchment (not the dark UI palette) on purpose, tilted a couple
// degrees in opposite directions. That inversion is deliberate here only; text on
// them uses fixed dark-on-light values rather than the theme's colors.ink (which is
// tuned to be light text on this app's now-dark screens).
const TICKET_BG = "#F5EFE3";
const TICKET_INK = "#1B2A3D";

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
  },
  titleStack: {
    marginBottom: 2,
  },
  prompt: {
    marginTop: 8,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkMuted,
  },
  meta: {
    marginTop: 4,
    fontFamily: fonts.body,
    color: colors.inkMuted,
    fontSize: 13,
  },
  notice: {
    marginTop: 4,
    marginBottom: 20,
    fontFamily: fonts.body,
    color: colors.gold,
    fontSize: 13,
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    gap: 16,
    marginTop: 20,
    marginBottom: 28,
  },
  card: {
    flex: 1,
    backgroundColor: TICKET_BG,
    borderRadius: 3,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  cardTiltLeft: {
    transform: [{ rotate: "-2deg" }],
  },
  cardTiltRight: {
    transform: [{ rotate: "2deg" }],
  },
  cardLabel: {
    fontFamily: fonts.bodyBold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontSize: 12,
    color: TICKET_INK,
  },
  score: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.accent,
    marginVertical: 4,
  },
  thumb: {
    width: "100%",
    height: 120,
    backgroundColor: colors.canvas,
    borderRadius: 4,
  },
  rationale: {
    marginTop: 8,
    fontFamily: fonts.body,
    fontSize: 12,
    color: TICKET_INK,
    opacity: 0.75,
  },
});
