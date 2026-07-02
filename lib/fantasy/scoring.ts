import type { LeagueScoringType, Player, StatCategory } from "./types";

export const pointsWeights: Partial<Record<StatCategory | "H" | "BB" | "IP" | "ER", number>> = {
  R: 1,
  HR: 4,
  RBI: 1,
  SB: 2,
  W: 5,
  SV: 5,
  K: 1,
  ER: -1,
  IP: 3,
};

export function formatScoringType(scoringType: LeagueScoringType) {
  switch (scoringType) {
    case "h2h-categories":
      return "H2H Categories";
    case "h2h-points":
      return "H2H Points";
    case "roto":
      return "Rotisserie";
  }
}

export function readPlayerStat(player: Player, category: string, projection = false) {
  const stats = projection ? player.projectedStats : player.seasonStats;
  return stats[category] ?? "-";
}

export function calculateSimplePoints(player: Player) {
  return Object.entries(player.seasonStats).reduce((total, [category, value]) => {
    const numeric = typeof value === "number" ? value : Number.parseFloat(value);
    const weight = pointsWeights[category as keyof typeof pointsWeights] ?? 0;

    if (Number.isNaN(numeric)) {
      return total;
    }

    return total + numeric * weight;
  }, 0);
}

