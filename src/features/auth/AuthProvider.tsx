import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
// QueryParams parses both `?code=` and `#access_token=` style auth callback URLs.
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { getAuthRedirectUrl, isSupabaseConfigured, supabase, supabaseConfigWarning } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

// Required once so a web OAuth popup closes itself after redirecting back.
WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = "google" | "apple";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  configWarning: string | null;
  ensureGuestSession: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  createAccount: (email: string, displayName?: string) => Promise<{ error?: string }>;
  signIn: (email: string) => Promise<{ error?: string }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<{ error?: string }>;
  upgradeProfile: (displayName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) {
      void refreshProfile();
    } else {
      setProfile(null);
    }
  }, [session, refreshProfile]);

  const ensureGuestSession = useCallback(async () => {
    if (!isSupabaseConfigured) {
      throw new Error("Supabase is not configured. Copy .env.example to .env and fill keys.");
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      // If EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are a
      // mismatched pair (different projects), every auth call fails with
      // Supabase's generic "Invalid API key" — swap in the specific,
      // actionable reason when we can detect that, instead of the dead end.
      throw new Error(supabaseConfigWarning ?? error.message);
    }
  }, []);

  // Parses a Supabase auth callback URL (magic link or OAuth redirect) and, if it
  // carries a token pair, establishes the session from it. Returns an error message
  // on failure, or undefined if the URL wasn't an auth callback / it succeeded.
  const createSessionFromUrl = useCallback(async (url: string) => {
    const { params, errorCode } = QueryParams.getQueryParams(url);
    if (errorCode) return errorCode;
    const { access_token, refresh_token } = params;
    if (!access_token || !refresh_token) return undefined;
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    return error?.message;
  }, []);

  // Native has no browser URL bar to auto-detect a session from, so we listen for the
  // app being opened via the `drawingbattle://` deep link a magic-link email or OAuth
  // redirect lands on.
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    void Linking.getInitialURL().then((url) => {
      if (url) void createSessionFromUrl(url);
    });

    const sub = Linking.addEventListener("url", ({ url }) => {
      void createSessionFromUrl(url);
    });
    return () => sub.remove();
  }, [createSessionFromUrl]);

  // The `upgrade_profile` RPC (below) is what flips a profile from guest to
  // permanent, but it only runs when we call it — there's no DB trigger for it
  // since it applies to an *existing* row (the insert trigger only covers new
  // users). Once a guest's session stops being anonymous (they confirmed a
  // magic-link or OAuth sign-in), finalize the profile automatically so no
  // extra manual step is needed after clicking the email link.
  useEffect(() => {
    if (!session?.user || session.user.is_anonymous !== false) return;
    if (!profile?.is_guest) return;
    const metaName = (session.user.user_metadata as { display_name?: string } | undefined)
      ?.display_name;
    void upgradeProfile(metaName ?? profile.display_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profile]);

  const createAccount = useCallback(async (email: string, displayName?: string) => {
    const trimmedEmail = email.trim();
    const name = displayName?.trim() || undefined;
    const emailRedirectTo = getAuthRedirectUrl();

    const { data } = await supabase.auth.getSession();
    if (data.session?.user.is_anonymous) {
      // Upgrade the current guest in place: same user id, same match history.
      const { error } = await supabase.auth.updateUser(
        { email: trimmedEmail, data: name ? { display_name: name } : undefined },
        { emailRedirectTo },
      );
      return { error: error?.message };
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo,
        data: { display_name: name, is_guest: false },
      },
    });
    return { error: error?.message };
  }, []);

  const signIn = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: getAuthRedirectUrl() },
    });
    return { error: error?.message };
  }, []);

  const signInWithOAuth = useCallback(async (provider: OAuthProvider) => {
    const redirectTo = getAuthRedirectUrl();
    const { data: sessionData } = await supabase.auth.getSession();
    const isAnonymous = Boolean(sessionData.session?.user.is_anonymous);

    // Linking attaches the OAuth identity to the current guest user instead of
    // creating a disconnected second account.
    const { data, error } = isAnonymous
      ? await supabase.auth.linkIdentity({ provider, options: { redirectTo, skipBrowserRedirect: true } })
      : await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });

    if (error) return { error: error.message };
    if (!data?.url) return { error: "Could not start sign-in." };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "success" && result.url) {
      const sessionError = await createSessionFromUrl(result.url);
      if (sessionError) return { error: sessionError };
    }
    return {};
  }, [createSessionFromUrl]);

  const upgradeProfile = useCallback(
    async (displayName: string) => {
      const { error } = await supabase.rpc("upgrade_profile", {
        p_display_name: displayName,
      });
      if (error) return { error: error.message };
      await refreshProfile();
      return {};
    },
    [refreshProfile],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      configured: isSupabaseConfigured,
      configWarning: supabaseConfigWarning,
      ensureGuestSession,
      refreshProfile,
      createAccount,
      signIn,
      signInWithOAuth,
      upgradeProfile,
      signOut,
    }),
    [
      session,
      profile,
      loading,
      ensureGuestSession,
      refreshProfile,
      createAccount,
      signIn,
      signInWithOAuth,
      upgradeProfile,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
