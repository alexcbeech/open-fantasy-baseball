export type LeagueScoringType = "h2h-categories" | "h2h-points" | "roto";

export type WaiverMode = "rolling" | "faab";

export type TradeReviewMode = "commissioner" | "league-vote" | "none";

export type LineupLockMode = "daily" | "weekly" | "first-game";

export type DraftType = "snake" | "offline";

export type PlayerPool =
  | "all"
  | "al"
  | "nl"
  | "al-east"
  | "al-central"
  | "al-west"
  | "nl-east"
  | "nl-central"
  | "nl-west";

export type StatCategory =
  | "R"
  | "HR"
  | "RBI"
  | "SB"
  | "AVG"
  | "W"
  | "SV"
  | "K"
  | "ERA"
  | "WHIP";

export type RosterSlot =
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "OF"
  | "UTIL"
  | "SP"
  | "RP"
  | "P"
  | "BN"
  | "IL"
  | "NA";

export type LeagueSettings = {
  id: string;
  name: string;
  scoringType: LeagueScoringType;
  teamCount: number;
  maxTeams: number;
  hitterCategories: StatCategory[];
  pitcherCategories: StatCategory[];
  rosterSlots: Record<RosterSlot, number>;
  inningsMinimumPerMatchup: number;
  waiverMode: WaiverMode;
  faabBudget: number;
  tradeReview: TradeReviewMode;
  tradeReviewDays: number;
  playoffTeamCount: number;
  lineupLockMode: LineupLockMode;
  draftType: DraftType;
  playerPool: PlayerPool;
  draftPickSeconds: number;
  allowILPlus: boolean;
  allowNA: boolean;
  addDropDeadlineDays: number[];
  waiverProcessingDays: number[];
};

export type TeamSummary = {
  id: string;
  leagueId: string;
  leagueName: string;
  teamName: string;
  managerName: string;
  scoringType: LeagueScoringType;
  record: string;
  rank: number;
  matchup: {
    opponentName: string;
    userScore: number;
    opponentScore: number;
    periodLabel: string;
    progressPercent: number;
  };
};

export type Player = {
  id: string;
  name: string;
  mlbPlayerId?: number | null;
  mlbTeam: string;
  positions: RosterSlot[];
  status: "active" | "day-to-day" | "injured" | "minors";
  availability: "rostered" | "free-agent" | "waivers";
  newsHeadline?: string;
  seasonStats: Record<string, number | string>;
  projectedStats: Record<string, number | string>;
  /** Season fantasy points to date (stored value); null in demo/mock mode. */
  seasonPoints?: number | null;
  /** The player's next scheduled MLB game, for row game-context lines. */
  nextGame?: PlayerNextGame | null;
  /**
   * Scheduled first pitch of the player's MLB game today (ISO), or null when
   * their team doesn't play today. Once this time passes, the player's lineup
   * slot is locked until the next daily roster rollover.
   */
  todaysGameStart?: string | null;
  /** Percent of leagues where the player is rostered; null when unknown. */
  rosteredPercent?: number | null;
  /**
   * True when the player is a probable starting pitcher in today's MLB game;
   * null/undefined when unknown or their team doesn't play today. Hitters
   * don't get a confirmed-starter signal, so this only ever flags pitchers.
   */
  probableStarterToday?: boolean | null;
  /** Average draft position (lower = drafted earlier); null when unknown. */
  adp?: number | null;
};

export type PlayerNewsItem = {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  sourceUrl?: string;
  publishedAt: string;
};

export type PlayerWatchItem = {
  id: string;
  name: string;
  status: Player["status"];
  headline: string;
};

export type PlayerStatWindow = {
  split: "season" | "last_7" | "last_14" | "last_30" | "projection_ros";
  label: string;
  stats: Record<string, number | string>;
  collectedAt?: string;
};

export type PlayerGameLog = {
  id: string;
  gamePk: number | null;
  date: string;
  opponent?: string;
  stats: Record<string, number | string>;
};

export type LivePlayerStatus = {
  /** True only when the player's team has a game in progress right now. */
  live: boolean;
  /** Inning/state label for a live game, e.g. "Bottom 7th"; null when not live. */
  state: string | null;
  /** The player's stat line so far in the live game (empty until they appear). */
  stats: Record<string, number | string>;
  /** Live fantasy points from the in-progress line; null when not live. */
  points: number | null;
};

export type PlayerNextGame = {
  date: string;
  opponent: string | null;
  homeAway: "home" | "away";
  venue: string | null;
};

export type PlayerValueMetrics = {
  fanPoints: number | null;
  rank: number | null;
  totalRanked: number;
  rosteredPercent: number | null;
};

export type PlayerDetail = Player & {
  mlbPlayerId: number | null;
  teamName: string | null;
  jerseyNumber: string | null;
  nextGame: PlayerNextGame | null;
  value: PlayerValueMetrics;
  news: PlayerNewsItem[];
  statWindows: PlayerStatWindow[];
  gameLog: PlayerGameLog[];
  /** Waiver context for the viewing team's league; null off waivers. */
  waiver?: {
    /** When the player clears waivers (ISO); null once only a claim remains. */
    until: string | null;
    myClaimPending: boolean;
    mode: "faab" | "rolling";
    faabRemaining: number | null;
  } | null;
  management: {
    canAdd: boolean;
    canClaim?: boolean;
    canCancelClaim?: boolean;
    canDrop: boolean;
    canMoveToIL: boolean;
    canMoveToNA: boolean;
  };
};

export type LineupPlayer = {
  slot: RosterSlot;
  player: Player;
  matchupTotal: number;
};

export type MatchupCategoryResult = "win" | "loss" | "tie";

export type MatchupCategoryScore = {
  category: string;
  userValue: number | string;
  opponentValue: number | string;
  result: MatchupCategoryResult;
};

export type MatchupDetails = {
  matchupId: string;
  periodLabel: string;
  userTeam: Pick<TeamSummary, "id" | "teamName">;
  opponentTeam: Pick<TeamSummary, "id" | "teamName">;
  userScore: number;
  opponentScore: number;
  categoryScores: MatchupCategoryScore[];
  userLineup: LineupPlayer[];
  opponentLineup: LineupPlayer[];
};

export type LiveMatchupUpdate = {
  /** True when at least one active player on either side has a game in progress. */
  live: boolean;
  /** Categories won by the viewing team / opponent, live-adjusted. */
  userScore: number;
  opponentScore: number;
  /** Category battle recomputed from season stats plus live in-game lines. */
  categoryScores: MatchupCategoryScore[];
  /** Live fantasy points per player id, for the head-to-head rows. */
  livePoints: Record<string, number>;
};

export type LeagueStanding = {
  teamId: string;
  teamName: string;
  managerName: string;
  rank: number;
  record: string;
  points: number;
};

export type LeagueTeamStats = {
  teamId: string;
  teamName: string;
  rosteredPlayers: number;
  faabRemaining: number;
  waiverPriority: number | null;
};

export type LeagueOverview = {
  leagueId: string;
  name: string;
  scoringType: LeagueScoringType;
  seasonYear: number;
  status: string;
  settings: LeagueSettings;
  standings: LeagueStanding[];
  teamStats: LeagueTeamStats[];
};
