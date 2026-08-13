import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { BrandTitle, ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { createRoom, getMyActiveMatch, joinRoom } from "@/features/match/api";
import { colors, fonts } from "@/lib/theme";

export default function LobbyScreen() {
  const { configured, loading, ensureGuestSession, profile, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || loading) return;
    void (async () => {
      try {
        await ensureGuestSession();
        const active = await getMyActiveMatch();
        if (active?.id && active.status !== "results" && active.status !== "cancelled") {
          router.replace(`/match/${active.id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start session");
      }
    })();
  }, [configured, loading, ensureGuestSession]);

  const withAuth = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await ensureGuestSession();
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <Screen>
        <BrandTitle />
        <Text style={styles.warn}>
          Supabase is not configured. Copy `.env.example` to `.env`, add your project URL and anon
          key, enable Anonymous Auth, run the SQL migration, then restart Expo.
        </Text>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#F7F1E3", "#E8DCC4", "#F4A261"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Screen style={{ backgroundColor: "transparent" }}>
        <BrandTitle />
        <Text style={styles.hello}>
          {profile ? `Playing as ${profile.display_name}` : user ? "Signing in…" : "Ready when you are"}
        </Text>
        {profile ? (
          <Text style={styles.record}>
            {profile.wins}W · {profile.losses}L
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label="Find opponent"
            loading={busy}
            onPress={() =>
              withAuth(async () => {
                router.push("/queue");
              })
            }
          />
          <PrimaryButton
            label="Create room"
            variant="secondary"
            loading={busy}
            onPress={() =>
              withAuth(async () => {
                const room = await createRoom();
                router.push(`/room?id=${room.id}&code=${room.code}`);
              })
            }
          />
          <View style={styles.joinRow}>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="ROOM CODE"
              placeholderTextColor={colors.inkMuted}
              autoCapitalize="characters"
              maxLength={6}
              style={styles.input}
            />
            <PrimaryButton
              label="Join"
              variant="secondary"
              disabled={code.trim().length < 4}
              loading={busy}
              onPress={() =>
                withAuth(async () => {
                  const match = await joinRoom(code.trim());
                  router.replace(`/match/${match.id}`);
                })
              }
            />
          </View>
          {profile?.is_guest ? (
            <PrimaryButton
              label="Sign in"
              variant="ghost"
              onPress={() => router.push("/auth")}
            />
          ) : null}
          <PrimaryButton
            label="Profile"
            variant="ghost"
            onPress={() => router.push("/profile")}
          />
        </View>
        <ErrorText message={error} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hello: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 4,
  },
  record: {
    color: colors.inkMuted,
    marginBottom: 24,
    fontSize: 15,
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
  joinRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  input: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 18,
    letterSpacing: 3,
    fontWeight: "700",
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  warn: {
    color: colors.danger,
    fontSize: 15,
    lineHeight: 22,
  },
});
