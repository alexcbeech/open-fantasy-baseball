import type { LeagueScoringType, Player, RosterSlot } from "./types";

export type PointStatSide = "hitting" | "pitching";
export type PointsWeightMap = Record<string, number>;

export type YahooPointCategory = {
  category: string;
  side: PointStatSide;
  weight: number;
};

const hitterRosterSlots = new Set<RosterSlot>(["C", "1B", "2B", "3B", "SS", "OF", "UTIL"]);
const pitcherRosterSlots = new Set<RosterSlot>(["SP", "RP", "P"]);
const hittingStatKeys = new Set(["G", "1B", "2B", "3B", "HR", "R", "RBI", "BB", "SB", "HBP", "AVG", "H", "AB"]);
const pitchingStatKeys = new Set(["G", "GS", "W", "SV", "K", "ERA", "WHIP", "IP", "ER", "P_BB", "P_H", "P_HBP", "O", "HA"]);

/**
 * Keep only the side of a two-way player's line that their fantasy lineup
 * slot is allowed to score. MLB returns hitting and pitching in one daily line
 * for two-way players, but a hitter slot and a pitcher slot must never receive
 * both sides of that production.
 */
export function statsForRosterSlot(
  stats: Record<string, number | string>,
  slot: RosterSlot,
): Record<string, number | string> {
  const allowedKeys = hitterRosterSlots.has(slot) ? hittingStatKeys : pitcherRosterSlots.has(slot) ? pitchingStatKeys : null;
  if (!allowedKeys) {
    return {};
  }
  return Object.fromEntries(Object.entries(stats).filter(([key]) => allowedKeys.has(key)));
}

/** Yahoo's default fantasy-baseball points scoring, in display order. */
export const yahooPointCategories: YahooPointCategory[] = [
  { category: "1B", side: "hitting", weight: 2.6 },
  { category: "2B", side: "hitting", weight: 5.2 },
  { category: "3B", side: "hitting", weight: 7.8 },
  { category: "HR", side: "hitting", weight: 10.4 },
  { category: "R", side: "hitting", weight: 1.9 },
  { category: "RBI", side: "hitting", weight: 1.9 },
  { category: "BB", side: "hitting", weight: 2.6 },
  { category: "SB", side: "hitting", weight: 4.2 },
  { category: "HBP", side: "hitting", weight: 2.6 },
  { category: "SV", side: "pitching", weight: 8 },
  { category: "W", side: "pitching", weight: 8 },
  { category: "K", side: "pitching", weight: 3 },
  { category: "ER", side: "pitching", weight: -3 },
  { category: "O", side: "pitching", weight: 1 },
  { category: "BB", side: "pitching", weight: -1.3 },
  { category: "H", side: "pitching", weight: -1.3 },
  { category: "HBP", side: "pitching", weight: -1.3 },
];

/**
 * Pitching stats with Yahoo names that overlap batting stats use internal
 * P_-prefixed keys in a flat stat line. The league configuration retains the
 * familiar Yahoo category name plus its hitting/pitching side.
 */
export function pointStatKey(side: PointStatSide, category: string) {
  return side === "pitching" && ["BB", "H", "HBP"].includes(category) ? `P_${category}` : category;
}

export function buildPointsWeightMap(
  rows: Array<{ category: string; side: PointStatSide; points_weight: number | string | null }>,
): PointsWeightMap {
  return Object.fromEntries(
    rows
      .filter((row) => row.points_weight !== null)
      .map((row) => [pointStatKey(row.side, row.category), Number(row.points_weight)]),
  );
}

export const yahooPointsWeights: PointsWeightMap = Object.fromEntries(
  yahooPointCategories.map((entry) => [pointStatKey(entry.side, entry.category), entry.weight]),
);

// Backward-compatible export for callers that referenced the old constant.
export const pointsWeights = yahooPointsWeights;

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

function numericStat(value: number | string | undefined) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(numeric) ? numeric : 0;
}

function isPitchingLine(stats: Record<string, number | string>) {
  return ["IP", "O", "ER", "W", "SV", "P_BB", "P_H", "HA", "P_HBP", "ERA", "WHIP", "GS"].some(
    (key) => stats[key] !== undefined,
  );
}

/** Read a scoring stat, including derivations and compatibility with pre-Yahoo lines. */
function pointStatValue(stats: Record<string, number | string>, key: string) {
  if (key === "1B" && stats["1B"] === undefined) {
    return Math.max(0, numericStat(stats.H) - numericStat(stats["2B"]) - numericStat(stats["3B"]) - numericStat(stats.HR));
  }
  if (key === "O" && stats.O === undefined) {
    return Math.round(inningsFromIpNotation(stats.IP) * 3);
  }
  if (key === "P_BB" && stats.P_BB === undefined && isPitchingLine(stats)) {
    return numericStat(stats.BB);
  }
  if (key === "P_H" && stats.P_H === undefined) {
    return numericStat(stats.HA);
  }
  // Before pitching walks were namespaced, BB on a pitching line meant walks
  // allowed and must not also receive the positive batter-walk weight.
  if (key === "BB" && stats.P_BB === undefined && isPitchingLine(stats)) {
    return 0;
  }
  return numericStat(stats[key]);
}

/** Fantasy points for an arbitrary stat line using league or Yahoo-default weights. */
export function calculateFantasyPoints(
  stats: Record<string, number | string>,
  weights: PointsWeightMap = yahooPointsWeights,
) {
  return Object.entries(weights).reduce((total, [key, weight]) => total + pointStatValue(stats, key) * weight, 0);
}

export function calculateSimplePoints(player: Player) {
  return calculateFantasyPoints(player.seasonStats);
}

