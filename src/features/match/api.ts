import { getFunctionsUrl, supabase } from "@/lib/supabase";
import type { Match, MatchSubmission, Room } from "@/lib/types";

export async function createRoom(): Promise<Room> {
  const { data, error } = await supabase.rpc("create_room");
  if (error) throw error;
  return data as Room;
}

export async function startSoloMatch(): Promise<Match> {
  const { data, error } = await supabase.rpc("start_solo_match");
  if (error) throw error;
  return data as Match;
}

export async function joinRoom(code: string): Promise<Match> {
  const { data, error } = await supabase.rpc("join_room", { p_code: code });
  if (error) throw error;
  return data as Match;
}

export async function leaveRoom(roomId: string) {
  const { error } = await supabase.rpc("leave_room", { p_room_id: roomId });
  if (error) throw error;
}

export async function joinQueue(): Promise<{ matched: boolean; match?: Match }> {
  const { data, error } = await supabase.rpc("join_queue");
  if (error) throw error;
  const payload = data as { matched: boolean; match?: Match };
  return payload;
}

export async function leaveQueue() {
  const { error } = await supabase.rpc("leave_queue");
  if (error) throw error;
}

export async function getMatch(matchId: string): Promise<Match | null> {
  await supabase.rpc("advance_match_phases");
  const { data, error } = await supabase.from("matches").select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  return data as Match | null;
}

export async function getMyActiveMatch(): Promise<Match | null> {
  const { data, error } = await supabase.rpc("get_my_active_match");
  if (error) throw error;
  // PostgREST returns a null-filled composite row when the RPC finds no match
  const match = data as Match | null;
  if (!match?.id) return null;
  return match;
}

export async function listRecentMatches(limit = 10): Promise<Match[]> {
  const { data, error } = await supabase.rpc("list_recent_matches", {
    limit_count: limit,
  });
  if (error) throw error;
  return (data as Match[]) ?? [];
}

export async function getSubmissions(matchId: string): Promise<MatchSubmission[]> {
  const { data, error } = await supabase
    .from("match_submissions")
    .select("*")
    .eq("match_id", matchId);
  if (error) throw error;
  return (data as MatchSubmission[]) ?? [];
}

export type SubmitDrawingResult = {
  submission: MatchSubmission;
  // True only for the one submit_drawing() call that atomically observed
  // both submissions present (see supabase/migrations/20260827090000_*.sql)
  // — the row lock submit_drawing() already takes means at most one
  // concurrent call can ever get true, so this is the race-free signal for
  // "you're the one who should call judge-match", replacing the old
  // "both clients independently notice status === judging and race each
  // other to request it" approach.
  shouldRequestJudging: boolean;
};

export async function submitDrawing(
  matchId: string,
  storagePath: string,
): Promise<SubmitDrawingResult> {
  const { data, error } = await supabase.rpc("submit_drawing", {
    p_match_id: matchId,
    p_storage_path: storagePath,
  });
  if (error) throw error;
  return data as SubmitDrawingResult;
}

function base64ToBytes(base64: string): Uint8Array {
  const atobFn = globalThis.atob?.bind(globalThis);
  if (atobFn) {
    const binary = atobFn(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Minimal pure-JS fallback
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const output: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const enc1 = chars.indexOf(clean[i]);
    const enc2 = chars.indexOf(clean[i + 1]);
    const enc3 = chars.indexOf(clean[i + 2]);
    const enc4 = chars.indexOf(clean[i + 3]);
    output.push((enc1 << 2) | (enc2 >> 4));
    if (clean[i + 2] !== "=") output.push(((enc2 & 15) << 4) | (enc3 >> 2));
    if (clean[i + 3] !== "=") output.push(((enc3 & 3) << 6) | enc4);
  }
  return Uint8Array.from(output);
}

export async function uploadDrawingPng(
  userId: string,
  matchId: string,
  base64Png: string,
): Promise<string> {
  const path = `${userId}/${matchId}.png`;
  const binary = base64ToBytes(base64Png);
  const { error } = await supabase.storage.from("drawings").upload(path, binary, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function requestJudgment(matchId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch(getFunctionsUrl("judge-match"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ matchId }),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? "Judging failed");
  }
  return body;
}

export function subscribeToMatch(
  matchId: string,
  onChange: (match: Match) => void,
) {
  const channel = supabase
    .channel(`match:${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "matches",
        filter: `id=eq.${matchId}`,
      },
      (payload) => {
        if (payload.new) onChange(payload.new as Match);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToRoom(roomId: string, onChange: (room: Room) => void) {
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "rooms",
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        if (payload.new) onChange(payload.new as Room);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeForUserMatches(userId: string, onMatch: (match: Match) => void) {
  const channel = supabase
    .channel(`user-matches:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "matches" },
      (payload) => {
        const match = payload.new as Match;
        if (match.player_a === userId || match.player_b === userId) {
          onMatch(match);
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
