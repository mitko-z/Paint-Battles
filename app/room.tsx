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
      if (next.status === "matched") {
        void supabase
          .from("matches")
          .select("id")
          .eq("room_id", next.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => {
            if (data?.id) router.replace(`/match/${data.id}`);
          });
      }
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
          router.replace(`/match/${match.id}`);
        },
      )
      .subscribe();

    return () => {
      unsubRoom();
      void supabase.removeChannel(channel);
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
