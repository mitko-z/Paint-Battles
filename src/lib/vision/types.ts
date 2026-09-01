// Vision judge types (client + edge share the contract conceptually)
export type VisionJudgeResult = {
  scoreA: number;
  scoreB: number;
  winner: "A" | "B" | "draw";
  rationaleA?: string;
  rationaleB?: string;
};

export type VisionJudgeInput = {
  prompt: string;
  imageAUrl: string;
  imageBUrl: string;
};

// Single-player mode: no opponent to compare against, so just a score
// against the prompt — there's no winner/draw concept for one drawing.
export type VisionSoloJudgeResult = {
  score: number;
  rationale?: string;
};

export type VisionSoloJudgeInput = {
  prompt: string;
  imageUrl: string;
};

export interface VisionJudge {
  score(input: VisionJudgeInput): Promise<VisionJudgeResult>;
  scoreSolo(input: VisionSoloJudgeInput): Promise<VisionSoloJudgeResult>;
}
