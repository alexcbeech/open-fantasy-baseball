import { defaultRosterSlots } from "./defaults";
import type { LineupLockMode, LineupPlayer, RosterSlot } from "./types";

export type LineupValidationIssue = {
  code: "duplicate-player" | "slot-overfilled" | "position-ineligible" | "player-status-ineligible" | "player-locked";
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
    // "UTIL" as a *position* marks bat-only players (DH types and players the
    // eligibility sync has no fielding position for) — the UTIL slot is
    // exactly where they belong.
    return player.positions.some((position) => ["C", "1B", "2B", "3B", "SS", "OF", "UTIL"].includes(position));
  }

  if (slot === "P") {
    return player.positions.some((position) => ["SP", "RP", "P"].includes(position));
  }

  return player.positions.includes(slot);
}

function canUseSlot(entry: LineupPlayer) {
  return isSlotEligibleForPlayer(entry.player, entry.slot);
}

/**
 * Whether the player's lineup slot is locked right now: their MLB game today
 * has started (first pitch time has passed), so they can't be moved, benched,
 * or replaced until the next daily roster rollover. Players with no game today
 * are never locked.
 */
export function isPlayerGameLocked(player: Pick<LineupPlayer["player"], "todaysGameStart">, now = new Date()): boolean {
  return Boolean(player.todaysGameStart && new Date(player.todaysGameStart).getTime() <= now.getTime());
}

/**
 * In first-game lock mode the whole lineup locks together when the earliest
 * game of the day begins; returns that cutoff's passage.
 */
export function isLineupFirstGameLocked(lineup: Array<Pick<LineupPlayer, "player">>, now = new Date()): boolean {
  const starts = lineup
    .map((entry) => (entry.player.todaysGameStart ? new Date(entry.player.todaysGameStart).getTime() : null))
    .filter((value): value is number => value !== null);

  return starts.length > 0 && Math.min(...starts) <= now.getTime();
}

/**
 * Slot changes that would move a locked player. Daily mode locks each player
 * at their own game's first pitch; first-game mode locks the whole lineup at
 * the day's earliest first pitch. Shared by the lineup editor (inline notice)
 * and the lineup API (so the lock is enforced server-side, not just in UI).
 */
export function findLineupLockIssues(
  currentLineup: LineupPlayer[],
  proposedLineup: LineupPlayer[],
  now = new Date(),
  lockMode: LineupLockMode = "daily",
): LineupValidationIssue[] {
  const currentSlotByPlayer = new Map(currentLineup.map((entry) => [entry.player.id, entry.slot]));
  const issues: LineupValidationIssue[] = [];
  const lineupLocked = lockMode === "first-game" && isLineupFirstGameLocked(currentLineup, now);

  for (const entry of proposedLineup) {
    const currentSlot = currentSlotByPlayer.get(entry.player.id);
    const moved = currentSlot !== undefined && currentSlot !== entry.slot;

    if (moved && (lineupLocked || isPlayerGameLocked(entry.player, now))) {
      issues.push({
        code: "player-locked",
        message: lineupLocked
          ? `${entry.player.name} is locked: the day's first game has started. Lineup changes reopen at the next daily rollover.`
          : `${entry.player.name} is locked: their game has started. Lineup changes reopen at the next daily rollover.`,
        playerId: entry.player.id,
        slot: entry.slot,
      });
    }
  }

  return issues;
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
