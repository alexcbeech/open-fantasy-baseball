import { calculateFantasyPoints } from "./scoring";
import type { Player, RosterSlot } from "./types";

const pitcherPositions: RosterSlot[] = ["SP", "RP", "P"];
const batterPositions: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF"];

// Per-day pacing derived from the same assumptions as the rest-of-season
// projection model (deriveRosProjection): ROS stats cover ~45% of a 162-game
// season, so a hitter's per-game expectation is ROS points spread over ~73
// team games, and a starter's per-start expectation is ROS points spread over
// ~45% of a 32-start workload.
const ROS_REMAINING_FRACTION = 0.45;
const REMAINING_TEAM_GAMES = Math.round(162 * ROS_REMAINING_FRACTION);
const REMAINING_STARTS = Math.round(32 * ROS_REMAINING_FRACTION);

/**
 * Whether the player counts as "active today" for Start Active Players:
 * their MLB team plays today and they're healthy enough to appear. Hitters
 * and relievers qualify whenever their team has a game (confirmed batting
 * orders aren't posted until shortly before first pitch); a pitcher who is
 * only SP-eligible qualifies only when they're a probable starter today.
 */
export function startsToday(player: Player): boolean {
  if (!player.todaysGameStart) {
    return false;
  }

  if (player.status === "injured" || player.status === "minors") {
    return false;
  }

  // "UTIL" as a position = a bat-only (DH-type) player: an everyday hitter.
  const everydayEligible = player.positions.some(
    (position) => batterPositions.includes(position) || position === "UTIL" || position === "RP" || position === "P",
  );
  return everydayEligible || player.probableStarterToday === true;
}

/**
 * Multiplier for a hitter's platoon matchup against today's opposing probable
 * starter. League-wide splits: lefty bats lose roughly a tenth of their
 * production against lefty pitching (righties suffer a smaller same-side
 * penalty), and everyone gains a bit with the platoon advantage. Switch
 * hitters always bat from the favorable side. Returns 1 when either hand is
 * unknown.
 */
export function platoonFactor(bats: string | null | undefined, opposingThrows: string | null | undefined): number {
  if (!bats || (opposingThrows !== "L" && opposingThrows !== "R")) {
    return 1;
  }

  if (bats === "S") {
    return 1.03;
  }

  if (bats === opposingThrows) {
    return bats === "L" ? 0.85 : 0.95;
  }

  return bats === "L" ? 1.08 : 1.04;
}

/**
 * Expected fantasy points from TODAY's game: the per-day slice of the
 * rest-of-season projection, matchup-adjusted where the data allows.
 *
 * - No game today (or IL/minors): 0.
 * - Probable starting pitchers: a full start's worth of their ROS pitching.
 * - Other pitcher-only players (relievers): their ROS value spread across
 *   the team's remaining games — an expected value that prices in the chance
 *   they don't pitch today at all.
 * - Hitters: their per-game ROS slice, scaled by the platoon matchup against
 *   the opposing probable starter's throwing hand when both hands are known.
 */
export function projectTodayPoints(player: Player): number {
  if (!startsToday(player)) {
    return 0;
  }

  const rosPoints = calculateFantasyPoints(player.projectedStats);

  if (rosPoints <= 0) {
    return 0;
  }

  if (player.probableStarterToday === true) {
    return rosPoints / REMAINING_STARTS;
  }

  const pitcherOnly = player.positions.every((position) => pitcherPositions.includes(position));

  if (pitcherOnly) {
    return rosPoints / REMAINING_TEAM_GAMES;
  }

  return (rosPoints / REMAINING_TEAM_GAMES) * platoonFactor(player.bats, player.todaysOpposingPitcherThrows);
}
