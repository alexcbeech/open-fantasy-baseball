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
// Per-player try order: dedicated first so flex stays open, bench last.
const assignableSlots: RosterSlot[] = [...dedicatedSlots, ...flexSlots, "BN"];

type SeatablePlayer = { positions: readonly RosterSlot[]; status: AssignablePlayer["status"] };

/**
 * Seat players into slots (dedicated → flex → bench) using augmenting-path
 * matching: when a player's slots are all taken, an existing occupant is
 * relocated if any rearrangement allows it. Seats the maximum possible number
 * of players; the returned map omits players no arrangement can seat.
 */
function seatPlayers(players: SeatablePlayer[], slotCounts: Record<RosterSlot, number>): Map<number, RosterSlot> {
  const capacity = new Map<RosterSlot, number>(assignableSlots.map((slot) => [slot, slotCounts[slot] ?? 0]));
  const occupants = new Map<RosterSlot, number[]>(assignableSlots.map((slot) => [slot, []]));
  const seatBySlot = new Map<number, RosterSlot>();

  const seat = (index: number, slot: RosterSlot) => {
    occupants.get(slot)?.push(index);
    seatBySlot.set(index, slot);
  };

  const tryPlace = (index: number, visited: Set<RosterSlot>): boolean => {
    const player = players[index];
    const slots = assignableSlots.filter(
      (slot) => !visited.has(slot) && (capacity.get(slot) ?? 0) > 0 && isSlotEligibleForPlayer(player, slot),
    );

    for (const slot of slots) {
      if ((occupants.get(slot)?.length ?? 0) < (capacity.get(slot) ?? 0)) {
        seat(index, slot);
        return true;
      }
    }

    for (const slot of slots) {
      visited.add(slot);
      const seated = occupants.get(slot) ?? [];

      for (let position = 0; position < seated.length; position += 1) {
        const [displaced] = seated.splice(position, 1);

        if (tryPlace(displaced, visited)) {
          seat(index, slot);
          return true;
        }

        seated.splice(position, 0, displaced);
      }
    }

    return false;
  };

  // Fewest eligible dedicated slots first = most constrained first, so slot
  // preference (not just seat count) favors scarce-position players.
  const order = players
    .map((_, index) => index)
    .sort((a, b) => countEligibleDedicated(players[a], slotCounts) - countEligibleDedicated(players[b], slotCounts));

  for (const index of order) {
    tryPlace(index, new Set());
  }

  return seatBySlot;
}

/**
 * Initial-lineup assignment for a freshly drafted roster: fill dedicated
 * starting slots first, then flex (UTIL/P), overflow to bench. Uses matching,
 * so a player is only left without a seat when no rearrangement could fit
 * them — such players are parked on BN anyway (overfilling it) and left for
 * the manager to resolve via the lineup editor's validation.
 */
export function planInitialLineup(players: AssignablePlayer[], slotCounts: Record<RosterSlot, number>): LineupAssignment[] {
  const seats = seatPlayers(players, slotCounts);
  return players.map((player, index) => ({ playerId: player.playerId, slot: seats.get(index) ?? "BN" }));
}

/**
 * Whether every one of these position-sets can occupy some slot (dedicated,
 * flex, or bench) at once. The draft uses this to refuse picks that could
 * never fit the roster — the failure mode being a bench overfilled at draft
 * completion, which then blocks every lineup save for the team.
 */
export function rosterFits(positionSets: RosterSlot[][], slotCounts: Record<RosterSlot, number>): boolean {
  const players = positionSets.map((positions) => ({ positions, status: "active" as const }));
  return seatPlayers(players, slotCounts).size === players.length;
}

function countEligibleDedicated(player: SeatablePlayer, slotCounts: Record<RosterSlot, number>): number {
  return dedicatedSlots.filter((slot) => (slotCounts[slot] ?? 0) > 0 && isSlotEligibleForPlayer(player, slot)).length;
}
