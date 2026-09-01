import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { getMyActiveMatch, joinQueue, leaveQueue, subscribeForUserMatches } from "@/features/match/api";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";

const OPPONENT_SEARCH_TIMEOUT_MS = 30000;

// Supabase RPC errors (PostgrestError) are plain objects, not instances of
// the native Error class — `e instanceof Error` is false for them and
// `String(e)` collapses to the useless "[object Object]". Pull `.message`
// off anything that has one before falling back to JSON/String.
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export default function QueueScreen() {
  const { ensureGuestSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(true);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let searchTimeout: ReturnType<typeof setTimeout> | null = null;

    const gotMatch = (matchId: string) => {
      if (cancelled) return;
      cancelled = true;
      router.replace(`/match/${matchId}`);
    };

    // Any error on a poll tick — whatever its shape or exact wording —
    // should just trigger "go check if I already have an active match."
    // Relying on matching specific server error text is fragile; this
    // fallback is cheap and harmless to call even when it turns out
    // there's nothing to find yet.
    const checkForExistingMatch = async () => {
      try {
        const match = await getMyActiveMatch();
        if (match?.id && match.status !== "results") gotMatch(match.id);
      } catch {
        // next poll tick will retry
      }
    };

    void (async () => {
      try {
        setTimedOut(false);
        await ensureGuestSession();
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) throw new Error("Not signed in");

        unsub = subscribeForUserMatches(userId, (match) => gotMatch(match.id));

        const result = await joinQueue();
        if (cancelled) return;
        if (result.matched && result.match) {
          gotMatch(result.match.id);
          return;
        }
        setSearching(true);

        // R1.5: an indefinite spinner looks identical to "everything is
        // broken." After 30s with no opponent, say so plainly and make
        // sure Cancel is easy to find, instead of leaving the player to
        // guess whether matchmaking is stuck.
        searchTimeout = setTimeout(() => {
          if (!cancelled) setTimedOut(true);
        }, OPPONENT_SEARCH_TIMEOUT_MS);

        // Two things this loop needs to guard against:
        // 1. Realtime delivery isn't guaranteed to be live yet when we
        //    start waiting (the channel may still be establishing its
        //    WebSocket handshake — slower and more variable on mobile
        //    networks than on web), so a missed INSERT event shouldn't
        //    strand the player here forever.
        // 2. join_queue()'s opponent search only considers queue rows
        //    with joined_at within the last 5 minutes. A player who sits
        //    on this screen longer than that becomes permanently
        //    unmatchable unless something refreshes their queue ticket.
        //
        // Re-calling joinQueue() itself (rather than just checking for a
        // match someone else created) solves both: it keeps our own
        // queued_at fresh indefinitely, and it actively retries pairing
        // every tick instead of passively waiting to be found.
        poll = setInterval(() => {
          void joinQueue()
            .then((result) => {
              if (result.matched && result.match) gotMatch(result.match.id);
            })
            .catch(() => {
              // Expected once someone else has already matched us: the
              // active_match_for() guard in join_queue() rejects with
              // "Already in an active match" rather than returning it.
              void checkForExistingMatch();
            });
        }, 2000);
      } catch (e) {
        if (!cancelled) {
          setError(describeError(e));
          setSearching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      if (poll) clearInterval(poll);
      if (searchTimeout) clearTimeout(searchTimeout);
      void leaveQueue();
    };
  }, [ensureGuestSession]);

  return (
    <Screen>
      <Text style={styles.title}>Finding opponent</Text>
      <Text style={styles.sub}>
        {timedOut
          ? "Still looking — no one's available to match with right now."
          : "Hang tight — pairing with the next player in queue."}
      </Text>
      <View style={styles.center}>
        {searching ? <ActivityIndicator size="large" color={colors.accent} /> : null}
      </View>
      {timedOut ? (
        <Text style={styles.timeoutNote}>
          You can keep waiting, or cancel and try again later.
        </Text>
      ) : null}
      <ErrorText message={error} />
      <PrimaryButton
        label="Cancel"
        variant={timedOut ? "primary" : "secondary"}
        onPress={async () => {
          await leaveQueue();
          router.replace("/lobby");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
    marginBottom: 8,
  },
  sub: {
    color: colors.inkMuted,
    fontSize: 16,
    marginBottom: 32,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  timeoutNote: {
    color: colors.inkMuted,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
});
