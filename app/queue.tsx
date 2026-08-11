import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { joinQueue, leaveQueue, subscribeForUserMatches } from "@/features/match/api";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";

export default function QueueScreen() {
  const { ensureGuestSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(true);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;

    void (async () => {
      try {
        await ensureGuestSession();
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) throw new Error("Not signed in");

        unsub = subscribeForUserMatches(userId, (match) => {
          if (!cancelled) router.replace(`/match/${match.id}`);
        });

        const result = await joinQueue();
        if (cancelled) return;
        if (result.matched && result.match) {
          router.replace(`/match/${result.match.id}`);
          return;
        }
        setSearching(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Queue failed");
          setSearching(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsub();
      void leaveQueue();
    };
  }, [ensureGuestSession]);

  return (
    <Screen>
      <Text style={styles.title}>Finding opponent</Text>
      <Text style={styles.sub}>Hang tight — pairing with the next player in queue.</Text>
      <View style={styles.center}>
        {searching ? <ActivityIndicator size="large" color={colors.accent} /> : null}
      </View>
      <ErrorText message={error} />
      <PrimaryButton
        label="Cancel"
        variant="secondary"
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
});
