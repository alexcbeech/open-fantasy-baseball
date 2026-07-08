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

/**
 * True innings from baseball IP notation, where the tenths digit counts outs:
 * "6.2" is 6 innings plus 2 outs = 6.667 innings. Required before summing or
 * weighting IP — adding the notation as a plain decimal understates innings.
 */
export function inningsFromIpNotation(value: number | string | undefined): number {
  const raw = typeof value === "number" ? value : Number.parseFloat(value ?? "");

  if (!Number.isFinite(raw)) {
    return 0;
  }

  const whole = Math.trunc(raw);
  const outs = Math.round((raw - whole) * 10);

  return whole + outs / 3;
}

/** Fantasy points for an arbitrary stat line using the default points weights. */
export function calculateFantasyPoints(stats: Record<string, number | string>) {
  return Object.entries(stats).reduce((total, [category, value]) => {
    const numeric =
      category === "IP" ? inningsFromIpNotation(value) : typeof value === "number" ? value : Number.parseFloat(value);
    const weight = pointsWeights[category as keyof typeof pointsWeights] ?? 0;

    if (Number.isNaN(numeric)) {
      return total;
    }

    return total + numeric * weight;
  }, 0);
}

export function calculateSimplePoints(player: Player) {
  return calculateFantasyPoints(player.seasonStats);
}

