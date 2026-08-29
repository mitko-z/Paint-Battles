import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { Screen } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { colors, fonts } from "@/lib/theme";

// Where a magic-link or OAuth email redirects back to on web (native lands
// via the drawingbattle:// deep link instead, handled in AuthProvider).
// supabase-js's `detectSessionInUrl` (enabled for web in src/lib/supabase.ts)
// already reads the tokens out of the URL as soon as the client initializes,
// so this screen just waits for that session to show up and moves on.
export default function AuthCallbackScreen() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? "/lobby" : "/auth");
  }, [session, loading]);

  return (
    <Screen style={styles.center}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.text}>Signing you in…</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    marginTop: 16,
    color: colors.inkMuted,
    fontFamily: fonts.body,
  },
});
