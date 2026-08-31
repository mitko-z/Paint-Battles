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

// Catches the exact mistake we hit on 2026-08-26: EXPO_PUBLIC_SUPABASE_URL and
// EXPO_PUBLIC_SUPABASE_ANON_KEY pointing at two *different* Supabase projects
// (easy to do when switching which project you're pointed at — the anon key
// doesn't get repasted along with the URL). Both vars are individually
// "present" so isSupabaseConfigured stays true, but every auth/API call then
// fails with Supabase's generic "Invalid API key" — which doesn't say why.
// This decodes the (unsigned, publicly-readable) `ref` claim out of the JWT
// anon key and compares it to the URL's project subdomain, so the mismatch
// is caught and named at startup instead of chased through failed network
// calls. Client-side JWT decoding, no verification — fine here since we're
// only reading a claim to sanity-check our own config, not authenticating.
// Manual base64 → UTF-8 decode instead of the global `atob`: Hermes (React
// Native's JS engine) doesn't reliably provide `atob`/`btoa` — this is the
// same gap that breaks the `jwt-decode` package on RN (facebook/hermes#1178,
// auth0/jwt-decode#241) — and this app ships an Android build alongside web,
// so this can't assume a browser environment. No new dependency needed for
// a one-off "read one claim out of our own key" decode.
function base64ToUtf8(base64: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let buffer = 0;
  let bits = 0;
  let binary = "";
  for (const char of base64) {
    const value = alphabet.indexOf(char);
    if (value === -1) continue; // skip '=' padding and anything else unexpected
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      binary += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(
      binary
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
  } catch {
    return binary;
  }
}

function decodeJwtProjectRef(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = base64ToUtf8(base64);
    const parsed = JSON.parse(json) as { ref?: unknown };
    return typeof parsed.ref === "string" ? parsed.ref : null;
  } catch {
    return null;
  }
}

function urlProjectRef(url: string): string | null {
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

const urlRef = urlProjectRef(supabaseUrl);
const keyRef = supabaseAnonKey ? decodeJwtProjectRef(supabaseAnonKey) : null;

export const supabaseConfigWarning: string | null =
  isSupabaseConfigured && urlRef && keyRef && urlRef !== keyRef
    ? `EXPO_PUBLIC_SUPABASE_ANON_KEY is for project "${keyRef}" but EXPO_PUBLIC_SUPABASE_URL points to project "${urlRef}" — they must be the matched URL/key pair from the same Supabase project. Update .env (Dashboard → your project → Settings → API) and restart Expo.`
    : null;

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
