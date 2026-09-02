import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { getMatch, getSubmissions, requestJudgment } from "@/features/match/api";
import { supabase } from "@/lib/supabase";
import type { Match, MatchSubmission } from "@/lib/types";
import { colors, fonts } from "@/lib/theme";

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, refreshProfile } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [subs, setSubs] = useState<MatchSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      <Text style={styles.title}>{outcome || "Results"}</Text>
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
        />
        {match?.is_solo ? null : (
          <ResultCard
            label="Opponent"
            score={oppSub?.score}
            rationale={oppSub?.rationale}
            uri={publicUrl(oppSub?.storage_path)}
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
}: {
  label: string;
  score?: number | null;
  rationale?: string | null;
  uri?: string | null;
}) {
  return (
    <View style={styles.card}>
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

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 40,
    color: colors.ink,
  },
  prompt: {
    marginTop: 8,
    fontSize: 18,
    color: colors.inkMuted,
  },
  meta: {
    marginTop: 4,
    color: colors.inkMuted,
    fontSize: 13,
  },
  notice: {
    marginTop: 4,
    marginBottom: 20,
    color: colors.accentDark,
    fontSize: 13,
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    marginBottom: 24,
  },
  card: {
    flex: 1,
    backgroundColor: colors.paperDeep,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  cardLabel: {
    fontWeight: "700",
    color: colors.ink,
  },
  score: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.accentDark,
    marginVertical: 6,
  },
  thumb: {
    width: "100%",
    height: 120,
    backgroundColor: colors.canvas,
    borderRadius: 6,
  },
  rationale: {
    marginTop: 8,
    fontSize: 12,
    color: colors.inkMuted,
  },
});
