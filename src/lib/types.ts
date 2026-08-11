export type MatchStatus =
  | "waiting"
  | "countdown"
  | "drawing"
  | "submitting"
  | "judging"
  | "results"
  | "cancelled";

export type Profile = {
  id: string;
  display_name: string;
  is_guest: boolean;
  wins: number;
  losses: number;
  created_at: string;
};

export type Room = {
  id: string;
  code: string;
  host_id: string;
  guest_id: string | null;
  status: "waiting" | "matched" | "closed";
  created_at: string;
};

export type Match = {
  id: string;
  room_id: string | null;
  player_a: string;
  player_b: string;
  prompt: string;
  status: MatchStatus;
  countdown_ends_at: string | null;
  drawing_ends_at: string | null;
  submit_deadline_at: string | null;
  winner_id: string | null;
  is_draw: boolean;
  judge_latency_ms: number | null;
  created_at: string;
};

export type MatchSubmission = {
  id: string;
  match_id: string;
  user_id: string;
  storage_path: string;
  score: number | null;
  rationale: string | null;
  submitted_at: string;
};

export type StrokePoint = { x: number; y: number };
export type Stroke = {
  id: string;
  tool: "pen" | "eraser";
  points: StrokePoint[];
  width: number;
};
