import type { Player, RosterSlot } from "@/lib/fantasy/types";

export type DraftStatus = "setup" | "in_progress" | "paused" | "complete";

export type DraftTeam = {
  teamId: string;
  name: string;
  managerName: string;
  isBot: boolean;
  /** 1-based round-1 draft position. */
  position: number;
};

export type DraftPickRecord = {
  overallPick: number;
  round: number;
  pickInRound: number;
  teamId: string;
  playerId: string;
  playerName: string;
  positions: RosterSlot[];
  madeBy: "human" | "auto" | "bot";
};

export type DraftState = {
  draftId: string;
  leagueId: string;
  leagueName: string;
  status: DraftStatus;
  pickSeconds: number;
  rounds: number;
  teamCount: number;
  /** Teams in round-1 draft order. */
  teams: DraftTeam[];
  /** Every pick made so far, ascending by overall pick. */
  picks: DraftPickRecord[];
  onClock: { teamId: string; overallPick: number; round: number; pickInRound: number } | null;
  /** ISO deadline for the current pick; null when not in_progress. */
  deadline: string | null;
  /** ISO server time at response build; clients derive the countdown from
   *  deadline - serverNow so client clock skew never matters. */
  serverNow: string;
  /** The viewer's team in this draft, if any. */
  myTeamId: string | null;
  viewerIsCommissioner: boolean;
};

export type DraftPlayer = Player & {
  adpRank: number | null;
  adp: number | null;
};

export class DraftError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
