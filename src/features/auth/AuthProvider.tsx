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
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  ensureGuestSession: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ error?: string }>;
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
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        data: { is_guest: false },
      },
    });
    return { error: error?.message };
  }, []);

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
      ensureGuestSession,
      refreshProfile,
      signInWithEmail,
      upgradeProfile,
      signOut,
    }),
    [
      session,
      profile,
      loading,
      ensureGuestSession,
      refreshProfile,
      signInWithEmail,
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
