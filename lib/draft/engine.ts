import type { DraftType, RosterSlot } from "@/lib/fantasy/types";

/**
 * Maps a 1-based overall pick number to a 0-based index into the round-1
 * draft order. Pluggable so other formats can slot in later without touching
 * the advancement or persistence layers.
 */
export interface OrderStrategy {
  teamIndexForPick(overallPick: number, teamCount: number): number;
}

/** Classic snake: even rounds (0-based) run forward, odd rounds reverse. */
export const snakeOrderStrategy: OrderStrategy = {
  teamIndexForPick(overallPick, teamCount) {
    const round = Math.floor((overallPick - 1) / teamCount);
    const offset = (overallPick - 1) % teamCount;
    return round % 2 === 0 ? offset : teamCount - 1 - offset;
  },
};

/** Same order every round; used by offline drafts. */
export const linearOrderStrategy: OrderStrategy = {
  teamIndexForPick(overallPick, teamCount) {
    return (overallPick - 1) % teamCount;
  },
};

export function orderStrategyFor(draftType: DraftType): OrderStrategy {
  return draftType === "snake" ? snakeOrderStrategy : linearOrderStrategy;
}

export function roundForPick(overallPick: number, teamCount: number): { round: number; pickInRound: number } {
  return {
    round: Math.floor((overallPick - 1) / teamCount) + 1,
    pickInRound: ((overallPick - 1) % teamCount) + 1,
  };
}

export function totalPicks(rounds: number, teamCount: number): number {
  return rounds * teamCount;
}

/**
 * Number of draft rounds for a league: every roster slot is drafted except
 * IL and NA, which start empty (they are status-gated stashes, not seats).
 */
export function draftRounds(rosterSlots: Record<RosterSlot, number>): number {
  return Object.entries(rosterSlots)
    .filter(([slot]) => slot !== "IL" && slot !== "NA")
    .reduce((sum, [, count]) => sum + count, 0);
}
