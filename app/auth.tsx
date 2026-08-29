import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import {
  Divider,
  ErrorText,
  PrimaryButton,
  Screen,
  SegmentedTabs,
  SuccessText,
  TextField,
} from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { oauthProviders } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";

type Mode = "signup" | "signin";

export default function AuthScreen() {
  const { createAccount, signIn, signInWithOAuth, profile } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState(
    profile?.is_guest ? "" : (profile?.display_name ?? ""),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const emailValid = /\S+@\S+\.\S+/.test(email.trim());
  const showOAuth = oauthProviders.google || oauthProviders.apple;

  const changeMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setMessage(null);
  };

  const submitEmail = async () => {
    setError(null);
    setMessage(null);
    setBusy("email");
    try {
      const res = mode === "signup" ? await createAccount(email, displayName) : await signIn(email);
      if (res.error) setError(res.error);
      else setMessage("Check your email for a sign-in link.");
    } finally {
      setBusy(null);
    }
  };

  const submitOAuth = async (provider: "google" | "apple") => {
    setError(null);
    setMessage(null);
    setBusy(provider);
    try {
      const res = await signInWithOAuth(provider);
      if (res.error) setError(res.error);
      else router.replace("/lobby");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>{mode === "signup" ? "Create your account" : "Welcome back"}</Text>
      <Text style={styles.sub}>
        {mode === "signup"
          ? "Keep your wins and matches across devices."
          : "Sign in to an account you already have."}
      </Text>

      <SegmentedTabs
        value={mode}
        onChange={changeMode}
        options={[
          { value: "signup", label: "Create account" },
          { value: "signin", label: "Sign in" },
        ]}
      />

      <View style={styles.form}>
        {mode === "signup" ? (
          <TextField
            label="Display name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            autoCapitalize="words"
          />
        ) : null}
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <PrimaryButton
          label={mode === "signup" ? "Create account" : "Send sign-in link"}
          onPress={submitEmail}
          disabled={!emailValid}
          loading={busy === "email"}
        />
      </View>

      {showOAuth ? (
        <>
          <Divider label="or continue with" />
          <View style={styles.oauthRow}>
            {oauthProviders.google ? (
              <PrimaryButton
                label="Google"
                variant="secondary"
                style={styles.oauthBtn}
                loading={busy === "google"}
                onPress={() => submitOAuth("google")}
              />
            ) : null}
            {oauthProviders.apple ? (
              <PrimaryButton
                label="Apple"
                variant="secondary"
                style={styles.oauthBtn}
                loading={busy === "apple"}
                onPress={() => submitOAuth("apple")}
              />
            ) : null}
          </View>
        </>
      ) : null}

      <SuccessText message={message} />
      <ErrorText message={error} />

      <PrimaryButton
        label="Continue as guest"
        variant="ghost"
        style={styles.guestBtn}
        onPress={() => router.replace("/lobby")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
    marginBottom: 6,
  },
  sub: {
    color: colors.inkMuted,
    fontSize: 15,
    marginBottom: 24,
  },
  form: {
    gap: 14,
    marginTop: 20,
  },
  oauthRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  oauthBtn: {
    flex: 1,
  },
  guestBtn: {
    marginTop: 24,
  },
});
