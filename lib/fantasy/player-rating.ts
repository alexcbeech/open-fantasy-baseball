import { calculateFantasyPoints, inningsFromIpNotation, statsForRosterSlot } from "./scoring";
import type { PlayerDetail, PlayerValueMetrics } from "./types";

export type PlayerStarRating = {
  stars: number;
  score: number;
  rank: number;
  totalRanked: number;
  position: string | null;
  rosteredPercent: number | null;
  recentForm: number | null;
};

const POSITION_WEIGHT = 0.68;
const RECENT_FORM_WEIGHT = 0.2;
const ROSTERED_WEIGHT = 0.12;
const hitterPositions = new Set(["C", "1B", "2B", "3B", "SS", "OF", "UTIL"]);
const pitcherPositions = new Set(["SP", "RP", "P"]);

function rankPercentile(rank: number | null, totalRanked: number): number | null {
  if (rank == null || !Number.isFinite(rank) || totalRanked <= 0) {
    return null;
  }
  const boundedRank = Math.min(totalRanked, Math.max(1, rank));
  return 1 - (boundedRank - 1) / totalRanked;
}

function numericStat(stats: Record<string, number | string>, key: string): number {
  const value = Number(stats[key]);
  return Number.isFinite(value) ? value : 0;
}

function rateFormScore(recentRate: number, seasonRate: number): number | null {
  if (!Number.isFinite(recentRate) || !Number.isFinite(seasonRate)) return null;

  // A full doubling/halving of rate reaches the cap. The floor prevents tiny
  // or negative season rates from creating an outsized trend signal.
  const relativeChange = (recentRate - seasonRate) / Math.max(Math.abs(seasonRate), 0.5);
  return 0.5 + Math.min(1, Math.max(-1, relativeChange)) * 0.5;
}

/**
 * Recent performance on a 0–1 scale: .5 is the player's season pace, 1 is
 * meaningfully hotter, and 0 meaningfully colder. Hitters are compared per
 * plate appearance and pitchers per inning so playing time alone is not
 * mistaken for form. Small samples return null and do not affect the rating.
 */
export function playerRecentForm(
  player: Pick<PlayerDetail, "positions" | "seasonStats" | "statWindows">,
): number | null {
  const recentStats = player.statWindows.find((window) => window.split === "last_7")?.stats;
  if (!recentStats) return null;

  const hasHitterPosition = player.positions.some((position) => hitterPositions.has(position));
  const hasPitcherPosition = player.positions.some((position) => pitcherPositions.has(position));
  const isHitter = hasHitterPosition || (!hasPitcherPosition && numericStat(player.seasonStats, "AB") > 0);
  const slot = isHitter ? "UTIL" : "P";
  const season = statsForRosterSlot(player.seasonStats, slot);
  const recent = statsForRosterSlot(recentStats, slot);

  if (isHitter) {
    const seasonOpportunities = numericStat(season, "AB") + numericStat(season, "BB") + numericStat(season, "HBP");
    const recentOpportunities = numericStat(recent, "AB") + numericStat(recent, "BB") + numericStat(recent, "HBP");
    if (seasonOpportunities <= 0 || recentOpportunities < 10) return null;
    return rateFormScore(
      calculateFantasyPoints(recent) / recentOpportunities,
      calculateFantasyPoints(season) / seasonOpportunities,
    );
  }

  const seasonInnings = inningsFromIpNotation(season.IP);
  const recentInnings = inningsFromIpNotation(recent.IP);
  if (seasonInnings <= 0 || recentInnings < 3) return null;
  return rateFormScore(
    calculateFantasyPoints(recent) / recentInnings,
    calculateFantasyPoints(season) / seasonInnings,
  );
}

/**
 * Convert player value into an explainable five-star rating. Production
 * relative to the player's best eligible position dominates, recent form can
 * move the result, and roster rate is a small market-confidence input. Overall
 * rank is the fallback when positional eligibility is unavailable.
 */
export function playerStarRating(value: PlayerValueMetrics, recentForm: number | null = null): PlayerStarRating | null {
  const hasPositionRank = value.positionRank != null && value.positionTotalRanked > 0;
  const rank = hasPositionRank ? value.positionRank : value.rank;
  const totalRanked = hasPositionRank ? value.positionTotalRanked : value.totalRanked;
  const performancePercentile = rankPercentile(rank, totalRanked);

  if (performancePercentile == null || rank == null) {
    return null;
  }

  const rosteredPercent = value.rosteredPercent == null
    ? null
    : Math.min(100, Math.max(0, value.rosteredPercent));
  const normalizedRecentForm = recentForm == null ? null : Math.min(1, Math.max(0, recentForm));
  const components = [
    { score: performancePercentile, weight: POSITION_WEIGHT },
    ...(normalizedRecentForm == null ? [] : [{ score: normalizedRecentForm, weight: RECENT_FORM_WEIGHT }]),
    ...(rosteredPercent == null ? [] : [{ score: rosteredPercent / 100, weight: ROSTERED_WEIGHT }]),
  ];
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const score = components.reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight;

  return {
    stars: Math.min(5, Math.max(1, Math.ceil(score * 5))),
    score,
    rank,
    totalRanked,
    position: hasPositionRank ? value.ratingPosition : null,
    rosteredPercent,
    recentForm: normalizedRecentForm,
  };
}
