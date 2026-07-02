import { defaultRosterSlots } from "./defaults";
import type { LineupPlayer, RosterSlot } from "./types";

export type LineupValidationIssue = {
  code: "duplicate-player" | "slot-overfilled" | "position-ineligible" | "player-status-ineligible";
  message: string;
  playerId?: string;
  slot?: RosterSlot;
};

const inactiveSlots: RosterSlot[] = ["BN", "IL", "NA"];

function canUseSlot(entry: LineupPlayer) {
  if (entry.slot === "BN") {
    return true;
  }

  if (entry.slot === "IL") {
    return entry.player.status === "injured" || entry.player.status === "day-to-day";
  }

  if (entry.slot === "NA") {
    return entry.player.status === "minors";
  }

  if (entry.slot === "UTIL") {
    return entry.player.positions.some((position) => ["C", "1B", "2B", "3B", "SS", "OF"].includes(position));
  }

  if (entry.slot === "P") {
    return entry.player.positions.some((position) => ["SP", "RP", "P"].includes(position));
  }

  return entry.player.positions.includes(entry.slot);
}

export function validateLineup(lineup: LineupPlayer[], rosterSlots = defaultRosterSlots) {
  const issues: LineupValidationIssue[] = [];
  const playerCounts = new Map<string, number>();
  const slotCounts = new Map<RosterSlot, number>();

  for (const entry of lineup) {
    playerCounts.set(entry.player.id, (playerCounts.get(entry.player.id) ?? 0) + 1);
    slotCounts.set(entry.slot, (slotCounts.get(entry.slot) ?? 0) + 1);

    if (!canUseSlot(entry)) {
      issues.push({
        code: inactiveSlots.includes(entry.slot) ? "player-status-ineligible" : "position-ineligible",
        message: `${entry.player.name} is not eligible for ${entry.slot}.`,
        playerId: entry.player.id,
        slot: entry.slot,
      });
    }
  }

  for (const [playerId, count] of playerCounts) {
    if (count > 1) {
      issues.push({
        code: "duplicate-player",
        message: "A player can only appear in one lineup slot.",
        playerId,
      });
    }
  }

  for (const [slot, count] of slotCounts) {
    const limit = rosterSlots[slot];

    if (count > limit) {
      issues.push({
        code: "slot-overfilled",
        message: `${slot} has ${count} players but only ${limit} slots are allowed.`,
        slot,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    slotUsage: Object.fromEntries(
      Object.entries(rosterSlots).map(([slot, limit]) => [
        slot,
        {
          used: slotCounts.get(slot as RosterSlot) ?? 0,
          limit,
        },
      ]),
    ) as Record<RosterSlot, { used: number; limit: number }>,
  };
}
