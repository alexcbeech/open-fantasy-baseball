import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import type { RosterSlot } from "@/lib/fantasy/types";

export type AssignablePlayer = {
  playerId: string;
  positions: RosterSlot[];
  status: "active" | "day-to-day" | "injured" | "minors";
};

export type LineupAssignment = {
  playerId: string;
  slot: RosterSlot;
};

const dedicatedSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const flexSlots: RosterSlot[] = ["UTIL", "P"];

/**
 * Greedy initial-lineup assignment for a freshly drafted roster: fill
 * dedicated starting slots first, then flex (UTIL/P), overflow to bench.
 * Scarce-position players are placed before flexible ones so a C/1B player
 * doesn't burn the only C slot a pure catcher needed.
 */
export function planInitialLineup(players: AssignablePlayer[], slotCounts: Record<RosterSlot, number>): LineupAssignment[] {
  const remaining: Record<RosterSlot, number> = { ...slotCounts };
  const assignments: LineupAssignment[] = [];

  // Fewest eligible dedicated slots first = most constrained first.
  const ordered = [...players].sort(
    (a, b) => countEligibleDedicated(a, slotCounts) - countEligibleDedicated(b, slotCounts),
  );

  for (const player of ordered) {
    const slotOrder = [...dedicatedSlots, ...flexSlots, "BN" as RosterSlot];
    const slot = slotOrder.find(
      (candidate) => (remaining[candidate] ?? 0) > 0 && isSlotEligibleForPlayer(player, candidate),
    );

    // BN is universal, so this only falls through when the bench itself is
    // full — possible if rounds exceed countable slots; park on BN anyway
    // and let the manager resolve via the lineup editor's validation.
    const resolved = slot ?? "BN";

    if (remaining[resolved] !== undefined) {
      remaining[resolved] -= 1;
    }

    assignments.push({ playerId: player.playerId, slot: resolved });
  }

  return assignments;
}

function countEligibleDedicated(player: AssignablePlayer, slotCounts: Record<RosterSlot, number>): number {
  return dedicatedSlots.filter((slot) => (slotCounts[slot] ?? 0) > 0 && isSlotEligibleForPlayer(player, slot)).length;
}
