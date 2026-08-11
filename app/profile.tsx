import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ErrorText, PrimaryButton, Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { listRecentMatches } from "@/features/match/api";
import type { Match } from "@/lib/types";
import { colors, fonts } from "@/lib/theme";

export default function ProfileScreen() {
  const { profile, refreshProfile, signInWithEmail, upgradeProfile, signOut } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(profile?.display_name ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshProfile();
    void listRecentMatches()
      .then(setMatches)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [refreshProfile]);

  useEffect(() => {
    if (profile?.display_name) setName(profile.display_name);
  }, [profile?.display_name]);

  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.sub}>
        {profile?.is_guest ? "Guest account — upgrade to keep your record across devices." : "Signed in"}
      </Text>
      <Text style={styles.record}>
        {profile?.wins ?? 0} wins · {profile?.losses ?? 0} losses
      </Text>

      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Display name"
        placeholderTextColor={colors.inkMuted}
      />
      <PrimaryButton
        label="Save name"
        variant="secondary"
        onPress={async () => {
          setError(null);
          const res = await upgradeProfile(name);
          if (res.error) setError(res.error);
          else setMessage("Profile updated");
        }}
      />

      <Text style={styles.section}>Email magic link</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor={colors.inkMuted}
      />
      <PrimaryButton
        label="Send sign-in link"
        onPress={async () => {
          setError(null);
          setMessage(null);
          const res = await signInWithEmail(email);
          if (res.error) setError(res.error);
          else setMessage("Check your email for the magic link.");
        }}
      />

      <Text style={styles.section}>Recent matches</Text>
      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        style={{ flexGrow: 0, maxHeight: 180 }}
        ListEmptyComponent={<Text style={styles.empty}>No finished matches yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.matchRow}>
            <Text style={styles.matchPrompt}>{item.prompt}</Text>
            <Text style={styles.matchMeta}>
              {item.is_draw ? "Draw" : item.winner_id === profile?.id ? "Win" : "Loss"}
            </Text>
          </View>
        )}
      />

      {message ? <Text style={styles.message}>{message}</Text> : null}
      <ErrorText message={error} />
      <View style={{ gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Back to lobby" variant="secondary" onPress={() => router.replace("/lobby")} />
        <PrimaryButton
          label="Sign out"
          variant="ghost"
          onPress={async () => {
            await signOut();
            router.replace("/lobby");
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 36,
    color: colors.ink,
  },
  sub: {
    color: colors.inkMuted,
    marginTop: 6,
    marginBottom: 8,
  },
  record: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 20,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    marginBottom: 10,
    backgroundColor: colors.white,
    color: colors.ink,
  },
  section: {
    marginTop: 20,
    marginBottom: 8,
    fontWeight: "700",
    color: colors.ink,
  },
  empty: { color: colors.inkMuted },
  matchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.inkMuted,
  },
  matchPrompt: { color: colors.ink, fontWeight: "600" },
  matchMeta: { color: colors.inkMuted },
  message: { color: colors.success, marginTop: 10 },
});
