import { rosterFits } from "@/lib/draft/lineup-assignment";
import type { RosterSlot } from "@/lib/fantasy/types";

export type TradeRosterPlayer = {
  playerId: string;
  positions: RosterSlot[];
};

export type TradeSides = {
  /** Active roster of the proposing team. */
  fromRoster: TradeRosterPlayer[];
  /** Active roster of the receiving team. */
  toRoster: TradeRosterPlayer[];
  /** Player ids moving from the proposing team to the receiving team. */
  offeredPlayerIds: string[];
  /** Player ids moving from the receiving team to the proposing team. */
  requestedPlayerIds: string[];
  /** Players the proposing team drops when the trade processes. */
  fromDropPlayerIds: string[];
  /** Players the receiving team drops when the trade processes. */
  toDropPlayerIds: string[];
};

/** One team's roster after the swap: keeps - outgoing - drops + incoming. */
function postTradeRoster(
  roster: TradeRosterPlayer[],
  outgoingIds: string[],
  dropIds: string[],
  incoming: TradeRosterPlayer[],
): TradeRosterPlayer[] {
  const leaving = new Set([...outgoingIds, ...dropIds]);
  return [...roster.filter((player) => !leaving.has(player.playerId)), ...incoming];
}

/**
 * Everything wrong with a proposed trade, as user-facing messages. Empty means
 * the trade is executable: both sides own what they're sending, nobody is both
 * traded and dropped, and both post-trade rosters still fit the league's slots
 * (including the bench) — the rule that forces unbalanced deals to include
 * drops or equal player counts.
 */
export function tradeIssues(sides: TradeSides, slotCounts: Record<RosterSlot, number>): string[] {
  const issues: string[] = [];
  const fromIds = new Set(sides.fromRoster.map((player) => player.playerId));
  const toIds = new Set(sides.toRoster.map((player) => player.playerId));

  if (!sides.offeredPlayerIds.length || !sides.requestedPlayerIds.length) {
    issues.push("A trade must send at least one player each way.");
  }

  if (sides.offeredPlayerIds.some((id) => !fromIds.has(id)) || sides.fromDropPlayerIds.some((id) => !fromIds.has(id))) {
    issues.push("The proposing team no longer has every player in the deal.");
  }

  if (sides.requestedPlayerIds.some((id) => !toIds.has(id)) || sides.toDropPlayerIds.some((id) => !toIds.has(id))) {
    issues.push("The receiving team no longer has every player in the deal.");
  }

  const fromLeaving = [...sides.offeredPlayerIds, ...sides.fromDropPlayerIds];
  const toLeaving = [...sides.requestedPlayerIds, ...sides.toDropPlayerIds];

  if (new Set(fromLeaving).size !== fromLeaving.length || new Set(toLeaving).size !== toLeaving.length) {
    issues.push("A player cannot be both traded and dropped in the same deal.");
  }

  if (issues.length) {
    return issues;
  }

  const offered = sides.fromRoster.filter((player) => sides.offeredPlayerIds.includes(player.playerId));
  const requested = sides.toRoster.filter((player) => sides.requestedPlayerIds.includes(player.playerId));
  const fromAfter = postTradeRoster(sides.fromRoster, sides.offeredPlayerIds, sides.fromDropPlayerIds, requested);
  const toAfter = postTradeRoster(sides.toRoster, sides.requestedPlayerIds, sides.toDropPlayerIds, offered);

  if (!rosterFits(fromAfter.map((player) => player.positions), slotCounts)) {
    issues.push("The deal would leave the proposing team with more players than their roster holds. Balance the players or add drops.");
  }

  if (!rosterFits(toAfter.map((player) => player.positions), slotCounts)) {
    issues.push("The deal would leave the receiving team with more players than their roster holds. Balance the players or add drops.");
  }

  return issues;
}

/**
 * Protest votes required to reject a trade under league-vote review: a strict
 * majority of the teams not involved in the trade. Never below one so a
 * two-voter league can still reject.
 */
export function votesNeededToReject(teamCount: number): number {
  const eligibleVoters = Math.max(teamCount - 2, 0);
  return eligibleVoters === 0 ? Number.POSITIVE_INFINITY : Math.floor(eligibleVoters / 2) + 1;
}
