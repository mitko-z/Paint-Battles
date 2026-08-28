import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { leaveRoom, subscribeToRoom } from "@/features/match/api";
import { supabase } from "@/lib/supabase";
import type { Room } from "@/lib/types";
import { colors, fonts } from "@/lib/theme";

export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string; code: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;

    const gotMatch = (matchId: string) => {
      if (cancelled) return;
      cancelled = true;
      router.replace(`/match/${matchId}`);
    };

    const checkForMatch = async () => {
      try {
        const { data } = await supabase
          .from("matches")
          .select("id")
          .eq("room_id", params.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.id) gotMatch(data.id);
      } catch {
        // ignore transient errors; next poll tick will retry
      }
    };

    void supabase
      .from("rooms")
      .select("*")
      .eq("id", params.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setRoom(data as Room);
      });

    const unsubRoom = subscribeToRoom(params.id, (next) => {
      setRoom(next);
      if (next.status === "matched") void checkForMatch();
    });

    const channel = supabase
      .channel(`room-match:${params.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "matches",
          filter: `room_id=eq.${params.id}`,
        },
        (payload) => {
          const match = payload.new as { id: string };
          gotMatch(match.id);
        },
      )
      .subscribe();

    // Same rationale as queue.tsx: realtime channel setup latency varies
    // a lot between web and mobile, so a missed INSERT event shouldn't be
    // able to strand a player in this room forever.
    const poll = setInterval(() => void checkForMatch(), 2000);

    return () => {
      cancelled = true;
      unsubRoom();
      void supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [params.id]);

  return (
    <Screen>
      <Text style={styles.title}>Private room</Text>
      <Text style={styles.sub}>Share this code with a friend</Text>
      <View style={styles.codeBox}>
        <Text style={styles.code}>{params.code ?? room?.code ?? "······"}</Text>
      </View>
      <Text style={styles.wait}>Waiting for opponent to join…</Text>
      <ErrorText message={error} />
      <PrimaryButton
        label="Leave room"
        variant="secondary"
        onPress={async () => {
          if (params.id) await leaveRoom(params.id);
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
  },
  sub: {
    color: colors.inkMuted,
    marginTop: 8,
    marginBottom: 28,
    fontSize: 16,
  },
  codeBox: {
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 28,
    alignItems: "center",
    marginBottom: 20,
  },
  code: {
    color: colors.paper,
    fontSize: 40,
    letterSpacing: 8,
    fontWeight: "800",
  },
  wait: {
    color: colors.inkMuted,
    marginBottom: 32,
    fontSize: 15,
  },
});
