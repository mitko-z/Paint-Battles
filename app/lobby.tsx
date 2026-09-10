import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { BrandTitle, ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { createRoom, getMyActiveMatch, joinRoom, startSoloMatch } from "@/features/match/api";
import { colors, fonts } from "@/lib/theme";

const waitingVideo = require("../assets/waiting.mp4");

export default function LobbyScreen() {
  const { configured, configWarning, loading, ensureGuestSession, profile, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Always muted and looping - this is ambient background motion, not a video the
  // player is meant to interact with, so there's no autoplay-policy issue here.
  const backgroundVideo = useVideoPlayer(waitingVideo, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    // play() has to be called after the VideoView has actually mounted - calling it
    // inside the useVideoPlayer setup callback above fires before that, so on web it
    // silently does nothing (the video just sits on its first frame).
    backgroundVideo.play();
  }, [backgroundVideo]);

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
        colors={["#22354A", "#1B2A3D", "#0F1822"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <VideoView
        player={backgroundVideo}
        style={styles.backgroundVideo}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />
      {/* Dark vignette so the cream text/buttons stay legible over moving footage, while
          the key art (painters, wordmark) up top stays visible rather than washed out. */}
      <LinearGradient
        colors={["rgba(15,22,32,0.05)", "rgba(15,22,32,0.55)", "rgba(15,22,32,0.93)"]}
        locations={[0, 0.45, 1]}
        style={styles.videoScrim}
        pointerEvents="none"
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

        {/* configWarning is a config-mismatch diagnosis (see src/lib/supabase.ts),
            not a reason to hide the actions below — the buttons stay live and
            tappable either way; every tap will just keep failing with the
            same reason until .env is fixed and Expo is restarted. */}
        {configWarning ? <Text style={styles.warn}>{configWarning}</Text> : null}

        <View style={styles.actions}>
          <PrimaryButton
            label="Single player mode"
            variant="secondary"
            loading={busy}
            onPress={() =>
              withAuth(async () => {
                const match = await startSoloMatch();
                router.replace(`/match/${match.id}`);
              })
            }
          />
          <PrimaryButton
            label="Find opponent"
            variant="secondary"
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
              variant="secondary"
              onPress={() => router.push("/auth")}
            />
          ) : null}
          <PrimaryButton
            label="Profile"
            variant="secondary"
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
  backgroundVideo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
  },
  videoScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hello: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 4,
  },
  record: {
    fontFamily: fonts.body,
    color: colors.gold,
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
    borderColor: colors.gold,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 18,
    letterSpacing: 3,
    fontFamily: fonts.bodyBold,
    color: colors.ink,
    backgroundColor: colors.paperDeep,
  },
  warn: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
});
