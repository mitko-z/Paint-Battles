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

export interface VisionJudge {
  score(input: VisionJudgeInput): Promise<VisionJudgeResult>;
}
