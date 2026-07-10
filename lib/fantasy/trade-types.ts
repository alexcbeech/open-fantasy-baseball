import type { RosterSlot } from "./types";

// Pure trade view-model types, importable from client components (the data
// layer module pulls in pg and must not reach the browser bundle).

export type TradeStatus =
  | "proposed"
  | "accepted"
  | "processed"
  | "declined"
  | "withdrawn"
  | "vetoed"
  | "voted_down"
  | "failed";

export type TradePlayerSummary = {
  playerId: string;
  name: string;
  positions: RosterSlot[];
  mlbTeam: string | null;
};

export type TradeSummary = {
  id: string;
  status: TradeStatus;
  fromTeam: { id: string; name: string };
  toTeam: { id: string; name: string };
  /** Players moving from the proposing team to the receiving team. */
  offered: TradePlayerSummary[];
  /** Players moving from the receiving team to the proposing team. */
  requested: TradePlayerSummary[];
  fromDrops: TradePlayerSummary[];
  toDrops: TradePlayerSummary[];
  createdAt: string;
  reviewEndsAt: string | null;
  votesAgainst: number;
  /** Protest votes that reject the trade; null when league votes don't apply. */
  votesNeeded: number | null;
  viewer: {
    canRespond: boolean;
    canWithdraw: boolean;
    canVote: boolean;
    hasVoted: boolean;
    canVeto: boolean;
  };
};
