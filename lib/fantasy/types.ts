export type LeagueScoringType = "h2h-categories" | "h2h-points" | "roto";

export type WaiverMode = "rolling" | "faab";

export type TradeReviewMode = "commissioner" | "league-vote" | "none";

export type LineupLockMode = "daily" | "weekly" | "first-game";

export type DraftType = "snake" | "auction" | "offline";

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
  management: {
    canAdd: boolean;
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
