import { defaultRosterSlots } from "./defaults";
import { isSlotEligibleForPlayer } from "./roster-validation";
import { calculateFantasyPoints } from "./scoring";
import type { LineupPlayer, Player, RosterSlot } from "./types";

// Dedicated slots are tried before flex so a multi-eligible player leaves
// UTIL/P open for players who have nowhere else to go.
const dedicatedStartingSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const flexStartingSlots: RosterSlot[] = ["UTIL", "P"];
const startingSlots: RosterSlot[] = [...dedicatedStartingSlots, ...flexStartingSlots];

const batterPositions: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF"];

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
 * Start Active Players priority: players in (or likely in) today's MLB
 * starting lineup first, then higher projected fantasy points, then better
 * (numerically lower) ADP, with name as a deterministic final tiebreaker.
 */
function comparePriority(a: Player, b: Player): number {
  const startDiff = Number(startsToday(b)) - Number(startsToday(a));
  if (startDiff !== 0) {
    return startDiff;
  }

  const projDiff = calculateFantasyPoints(b.projectedStats) - calculateFantasyPoints(a.projectedStats);
  if (projDiff !== 0) {
    return projDiff;
  }

  const adpDiff = (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY);
  if (adpDiff !== 0) {
    return adpDiff;
  }

  return a.name.localeCompare(b.name);
}

/**
 * Compute the "Start Active Players" slot assignment: fill every starting
 * slot with the highest-priority eligible players, bench the rest.
 *
 * Game-locked players and players parked on IL/NA keep their current slot
 * (a locked starter still consumes their slot's capacity). Everyone else is
 * placed by priority using augmenting-path matching, so a player is only
 * benched when no rearrangement of lower-priority players could seat them.
 * The returned map covers every player in the lineup and is ready for the
 * lineup editor's commit path, which revalidates and persists it.
 */
export function planActiveLineup(
  lineup: LineupPlayer[],
  lockedPlayerIds: ReadonlySet<string> = new Set(),
  rosterSlots: Record<RosterSlot, number> = defaultRosterSlots,
): Record<string, RosterSlot> {
  const capacity = new Map<RosterSlot, number>(startingSlots.map((slot) => [slot, rosterSlots[slot] ?? 0]));
  const result: Record<string, RosterSlot> = {};
  const pool: Player[] = [];

  for (const entry of lineup) {
    if (lockedPlayerIds.has(entry.player.id) || entry.slot === "IL" || entry.slot === "NA") {
      result[entry.player.id] = entry.slot;
      const remaining = capacity.get(entry.slot);
      if (remaining !== undefined) {
        capacity.set(entry.slot, remaining - 1);
      }
    } else {
      pool.push(entry.player);
    }
  }

  const assignedSlot = new Map<string, RosterSlot>();
  const occupants = new Map<RosterSlot, string[]>(startingSlots.map((slot) => [slot, []]));
  const playersById = new Map(pool.map((player) => [player.id, player]));

  const eligibleSlots = (player: Player) =>
    startingSlots.filter((slot) => (capacity.get(slot) ?? 0) > 0 && isSlotEligibleForPlayer(player, slot));

  const seat = (playerId: string, slot: RosterSlot) => {
    occupants.get(slot)?.push(playerId);
    assignedSlot.set(playerId, slot);
  };

  /**
   * Seat the player in a free eligible slot, or free one up by recursively
   * relocating a current occupant (classic augmenting path). `visited` stops
   * the search from revisiting a slot within one attempt.
   */
  const tryPlace = (playerId: string, visited: Set<RosterSlot>): boolean => {
    const player = playersById.get(playerId);
    if (!player) {
      return false;
    }

    const slots = eligibleSlots(player).filter((slot) => !visited.has(slot));

    for (const slot of slots) {
      if ((occupants.get(slot)?.length ?? 0) < (capacity.get(slot) ?? 0)) {
        seat(playerId, slot);
        return true;
      }
    }

    for (const slot of slots) {
      visited.add(slot);
      const seated = occupants.get(slot) ?? [];

      for (let index = 0; index < seated.length; index += 1) {
        const [displaced] = seated.splice(index, 1);

        if (tryPlace(displaced, visited)) {
          seat(playerId, slot);
          return true;
        }

        seated.splice(index, 0, displaced);
      }
    }

    return false;
  };

  for (const player of [...pool].sort(comparePriority)) {
    tryPlace(player.id, new Set());
  }

  for (const player of pool) {
    result[player.id] = assignedSlot.get(player.id) ?? "BN";
  }

  return result;
}
