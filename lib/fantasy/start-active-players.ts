import { projectTodayPoints, startsToday } from "./daily-projection";
import { defaultRosterSlots } from "./defaults";
import { isSlotEligibleForPlayer } from "./roster-validation";
import { calculateFantasyPoints } from "./scoring";
import type { LineupPlayer, Player, RosterSlot } from "./types";

export { startsToday } from "./daily-projection";

// Dedicated slots are tried before flex so a multi-eligible player leaves
// UTIL/P open for players who have nowhere else to go.
const dedicatedStartingSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const flexStartingSlots: RosterSlot[] = ["UTIL", "P"];
const startingSlots: RosterSlot[] = [...dedicatedStartingSlots, ...flexStartingSlots];
const pitcherPositions = new Set<RosterSlot>(["SP", "RP", "P"]);

/**
 * Pitchers need an explicit role tier: a non-starting SP must not jump ahead
 * of a reliever just because their season projection is higher. Hitters share
 * the middle tier with relievers; their existing active-today ordering still
 * decides hitter contests, while the unified tier keeps the comparator
 * transitive when hitter and pitcher rows are interleaved.
 */
function lineupPriorityTier(player: Player): number {
  const pitcherOnly = player.positions.length > 0 && player.positions.every((position) => pitcherPositions.has(position));

  if (!pitcherOnly) {
    return 1;
  }

  if (player.probableStarterToday === true && startsToday(player)) {
    return 0;
  }

  if (player.positions.includes("RP")) {
    return 1;
  }

  return 2;
}

/**
 * Start Active Players priority: pitchers use today's probable starters first,
 * RP-eligible arms second, and non-starting SPs last. Other players in (or
 * likely in) today's MLB starting lineup come first. Ties use expected points
 * from TODAY's game (matchup-aware — see projectTodayPoints), then higher
 * rest-of-season projection, better (numerically lower) ADP, and name.
 */
function comparePriority(a: Player, b: Player): number {
  const priorityTierDiff = lineupPriorityTier(a) - lineupPriorityTier(b);

  if (priorityTierDiff !== 0) {
    return priorityTierDiff;
  }

  const startDiff = Number(startsToday(b)) - Number(startsToday(a));
  if (startDiff !== 0) {
    return startDiff;
  }

  // A pitcher taking the mound today always outranks a reliever or bench arm
  // whose team merely plays, whatever their projections say. Only pitchers
  // carry this flag, and pitchers never contest batter slots, so hitters are
  // unaffected by this tier.
  const probableDiff = Number(b.probableStarterToday === true) - Number(a.probableStarterToday === true);
  if (probableDiff !== 0) {
    return probableDiff;
  }

  // Today's expected points differentiate players with a game (platoon
  // matchups, start vs. relief value); for two players sitting out it's 0-0
  // and the rest-of-season projection below decides.
  const todayDiff = projectTodayPoints(b) - projectTodayPoints(a);
  if (todayDiff !== 0) {
    return todayDiff;
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
