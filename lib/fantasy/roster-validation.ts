import { defaultRosterSlots } from "./defaults";
import type { LineupPlayer, RosterSlot } from "./types";

export type LineupValidationIssue = {
  code: "duplicate-player" | "slot-overfilled" | "position-ineligible" | "player-status-ineligible";
  message: string;
  playerId?: string;
  slot?: RosterSlot;
};

const inactiveSlots: RosterSlot[] = ["BN", "IL", "NA"];

type SlotEligibilityPlayer = {
  positions: readonly RosterSlot[];
  status: LineupPlayer["player"]["status"];
};

/**
 * Whether a player may occupy a given roster slot. Bench is universal; IL/NA
 * are status-gated; UTIL/P are position-group flex slots; every other slot
 * requires exact position eligibility. Shared by lineup validation and the
 * lineup editor's slot picker so the UI never offers an illegal move.
 */
export function isSlotEligibleForPlayer(player: SlotEligibilityPlayer, slot: RosterSlot): boolean {
  if (slot === "BN") {
    return true;
  }

  if (slot === "IL") {
    return player.status === "injured" || player.status === "day-to-day";
  }

  if (slot === "NA") {
    return player.status === "minors";
  }

  if (slot === "UTIL") {
    return player.positions.some((position) => ["C", "1B", "2B", "3B", "SS", "OF"].includes(position));
  }

  if (slot === "P") {
    return player.positions.some((position) => ["SP", "RP", "P"].includes(position));
  }

  return player.positions.includes(slot);
}

function canUseSlot(entry: LineupPlayer) {
  return isSlotEligibleForPlayer(entry.player, entry.slot);
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
