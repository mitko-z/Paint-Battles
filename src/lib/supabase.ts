import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes("YOUR_PROJECT") &&
  supabaseAnonKey !== "your-anon-key";

const memoryStore = new Map<string, string>();

const memoryStorage = {
  getItem: async (key: string) => memoryStore.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  removeItem: async (key: string) => {
    memoryStore.delete(key);
  },
};

const canUseNativeStorage = typeof window !== "undefined" || Platform.OS !== "web";

const storage = canUseNativeStorage
  ? {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
    }
  : memoryStorage;

export const supabase: SupabaseClient = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder",
  {
    auth: {
      storage,
      autoRefreshToken: canUseNativeStorage,
      persistSession: canUseNativeStorage,
      detectSessionInUrl: Platform.OS === "web" && typeof window !== "undefined",
    },
  },
);

export function getFunctionsUrl(path: string) {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${path}`;
}

/** Deep link the auth email/OAuth flows redirect back to once a session is issued. */
export function getAuthRedirectUrl() {
  return Linking.createURL("auth/callback");
}

// Social sign-in buttons only render once the developer has actually enabled the
// provider in the Supabase dashboard (and, for Apple, registered a Services ID) —
// otherwise they'd be dead buttons out of the box.
export const oauthProviders = {
  google: process.env.EXPO_PUBLIC_ENABLE_GOOGLE_AUTH === "true",
  apple: process.env.EXPO_PUBLIC_ENABLE_APPLE_AUTH === "true",
};
