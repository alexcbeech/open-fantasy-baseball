import type { RosterSlot } from "./types";

/** IL and NA are reserve stashes and do not consume ordinary active/bench capacity. */
export function countsTowardOrdinaryRoster(slot: RosterSlot | null | undefined): boolean {
  return slot !== "IL" && slot !== "NA";
}

type CapacityEntry = {
  playerId: string;
  positions: RosterSlot[] | null;
  slot: RosterSlot | null;
};

/** Position sets that must fit after an acquisition; reserve stashes stay outside the ordinary roster. */
export function positionSetsAfterAdd(
  roster: CapacityEntry[],
  incomingPositions: RosterSlot[],
  dropPlayerId?: string,
): RosterSlot[][] {
  return [
    ...roster
      .filter((entry) => entry.playerId !== dropPlayerId && countsTowardOrdinaryRoster(entry.slot))
      .map((entry) => (entry.positions?.length ? entry.positions : (["UTIL"] as RosterSlot[]))),
    incomingPositions.length ? incomingPositions : (["UTIL"] as RosterSlot[]),
  ];
}
