export type Provider = "github" | "gitlab";

export type ContributionDay = {
  date: string;
  count: number;
};

export type NormalizedContrib = {
  provider: Provider;
  username: string;
  from: string;
  to: string;
  days: ContributionDay[];
};

export type ScoreBreakdown = {
  base: number;
  progress: number;
  winBonus: number;
  deathPenalty: number;
};
