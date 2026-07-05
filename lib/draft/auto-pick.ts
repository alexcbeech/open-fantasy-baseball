import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import type { RosterSlot } from "@/lib/fantasy/types";

export type DraftCandidate = {
  playerId: string;
  /** 1 = best available. Derived ranking fills in when no external ADP exists. */
  adpRank: number;
  positions: RosterSlot[];
};

/** Remaining open slots per slot type for one team. */
export type RosterNeeds = Record<RosterSlot, number>;

/** Slots a drafted player consumes, in the order we try to consume them. */
const dedicatedSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const flexSlots: RosterSlot[] = ["UTIL", "P"];

/**
 * Pull toward filling an unfilled dedicated starting slot; push away from
 * players whose dedicated slots are all filled. Values are in "ADP ranks":
 * a need bonus of 12 means a needed player beats a generic player ranked up
 * to 11 spots higher. Tuned by the auto-pick tests (bots must not hoard one
 * position early).
 */
const NEED_BONUS = 12;
const SURPLUS_PENALTY = 25;

const draftedEligibilityStatus = "active" as const;

/**
 * Computes remaining slot needs for a team given league slot counts and the
 * positions of already-drafted players. Greedy: each drafted player consumes
 * their first open dedicated slot, then a flex slot, then bench — mirroring
 * how the initial lineup will be assigned at draft completion.
 */
export function computeRosterNeeds(
  slotCounts: Record<RosterSlot, number>,
  draftedPositions: RosterSlot[][],
): RosterNeeds {
  const needs = { ...slotCounts, IL: 0, NA: 0 };

  for (const positions of draftedPositions) {
    const player = { positions, status: draftedEligibilityStatus };
    const slotOrder = [...dedicatedSlots, ...flexSlots, "BN" as RosterSlot];
    const consumed = slotOrder.find((slot) => needs[slot] > 0 && isSlotEligibleForPlayer(player, slot));

    if (consumed) {
      needs[consumed] -= 1;
    }
  }

  return needs;
}

/**
 * Best available by ADP with positional-need adjustment. Score = adpRank,
 * minus a bonus when the player fills an unfilled dedicated slot, plus a
 * penalty when every dedicated slot for all their positions is full and
 * only flex/bench room remains. Lowest score wins; ties break on adpRank.
 */
export function selectAutoPick(candidates: DraftCandidate[], needs: RosterNeeds): DraftCandidate | null {
  let best: DraftCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const player = { positions: candidate.positions, status: draftedEligibilityStatus };
    const fillsNeed = dedicatedSlots.some((slot) => needs[slot] > 0 && isSlotEligibleForPlayer(player, slot));
    const hasDedicatedSlot = dedicatedSlots.some((slot) => isSlotEligibleForPlayer(player, slot));

    let score = candidate.adpRank;

    if (fillsNeed) {
      score -= NEED_BONUS;
    } else if (hasDedicatedSlot) {
      score += SURPLUS_PENALTY;
    }

    if (score < bestScore || (score === bestScore && best !== null && candidate.adpRank < best.adpRank)) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
