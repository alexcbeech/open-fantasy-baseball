import type { LeagueSettings, RosterSlot, StatCategory } from "./types";

export const defaultHitterCategories: StatCategory[] = ["R", "HR", "RBI", "SB", "AVG"];
export const defaultPitcherCategories: StatCategory[] = ["W", "SV", "K", "ERA", "WHIP"];

export const defaultRosterSlots: Record<RosterSlot, number> = {
  C: 1,
  "1B": 1,
  "2B": 1,
  "3B": 1,
  SS: 1,
  OF: 3,
  UTIL: 2,
  SP: 2,
  RP: 2,
  P: 4,
  BN: 5,
  IL: 4,
  NA: 0,
};

export const defaultLeagueSettings: LeagueSettings = {
  id: "default-yahoo-style",
  name: "OFB Default Baseball",
  scoringType: "h2h-categories",
  teamCount: 12,
  maxTeams: 20,
  hitterCategories: defaultHitterCategories,
  pitcherCategories: defaultPitcherCategories,
  rosterSlots: defaultRosterSlots,
  inningsMinimumPerMatchup: 7,
  waiverMode: "rolling",
  faabBudget: 100,
  tradeReview: "league-vote",
  tradeReviewDays: 2,
  playoffTeamCount: 6,
  lineupLockMode: "daily",
  draftType: "snake",
  allowILPlus: false,
  allowNA: false,
  addDropDeadlineDays: [0, 1, 2, 3, 4, 5, 6],
  waiverProcessingDays: [0, 1, 2, 3, 4, 5, 6],
};

export const commissionerEditableSettings = [
  "scoringType",
  "teamCount",
  "hitterCategories",
  "pitcherCategories",
  "rosterSlots",
  "inningsMinimumPerMatchup",
  "waiverMode",
  "faabBudget",
  "tradeReview",
  "tradeReviewDays",
  "playoffTeamCount",
  "waiverProcessingDays",
  "lineupLockTime",
  "tradeDeadline",
  "playoffWeeks",
  "draftType",
  "keeperRules",
  "allowILPlus",
  "addDropDeadlineDays",
] as const;
