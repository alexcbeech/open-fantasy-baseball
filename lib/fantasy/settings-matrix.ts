import type { DraftType, LeagueScoringType, LineupLockMode, PlayerPool, RosterSlot, StatCategory, TradeReviewMode, WaiverMode } from "./types";

export type CommissionerSettingKind =
  | "number"
  | "boolean"
  | "enum"
  | "multi-enum"
  | "roster-slots"
  | "stat-categories";

export type CommissionerSettingDefinition = {
  key: string;
  label: string;
  kind: CommissionerSettingKind;
  appliesTo: LeagueScoringType[];
  defaultValue:
    | number
    | boolean
    | string
    | number[]
    | RosterSlot[]
    | StatCategory[]
    | Record<RosterSlot, number>;
  options?: readonly string[] | readonly number[];
  min?: number;
  max?: number;
  description: string;
  commissionerEditable: boolean;
  locksAfterDraft?: boolean;
};

const allScoringTypes: LeagueScoringType[] = ["h2h-categories", "h2h-points", "roto"];

export const waiverModes: WaiverMode[] = ["rolling", "faab"];
export const tradeReviewModes: TradeReviewMode[] = ["league-vote", "commissioner", "none"];
export const lineupLockModes: LineupLockMode[] = ["daily", "weekly", "first-game"];
export const draftTypes: DraftType[] = ["snake", "auction", "offline"];
export const playerPools: PlayerPool[] = [
  "all",
  "al",
  "nl",
  "al-east",
  "al-central",
  "al-west",
  "nl-east",
  "nl-central",
  "nl-west",
];
export const draftPickSecondsOptions = [30, 60, 90, 120] as const;
export const scoringPeriods = ["daily", "weekly"] as const;

export const commissionerSettingsMatrix: CommissionerSettingDefinition[] = [
  {
    key: "scoringType",
    label: "Scoring Type",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: "h2h-categories",
    options: allScoringTypes,
    description: "League format: head-to-head categories, head-to-head points, or season-long roto.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "teamCount",
    label: "Teams",
    kind: "number",
    appliesTo: allScoringTypes,
    defaultValue: 12,
    min: 4,
    max: 20,
    description: "Number of fantasy teams competing in the league.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "hitterCategories",
    label: "Hitting Categories",
    kind: "stat-categories",
    appliesTo: ["h2h-categories", "roto"],
    defaultValue: ["R", "HR", "RBI", "SB", "AVG"],
    description: "Offensive categories used for category and roto scoring.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "pitcherCategories",
    label: "Pitching Categories",
    kind: "stat-categories",
    appliesTo: ["h2h-categories", "roto"],
    defaultValue: ["W", "SV", "K", "ERA", "WHIP"],
    description: "Pitching categories used for category and roto scoring.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "pointsWeights",
    label: "Points Weights",
    kind: "stat-categories",
    appliesTo: ["h2h-points"],
    defaultValue: ["R", "HR", "RBI", "SB", "W", "SV", "K"],
    description: "Stat events and weights used to calculate head-to-head points totals.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "rosterSlots",
    label: "Roster Positions",
    kind: "roster-slots",
    appliesTo: allScoringTypes,
    defaultValue: {
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
    },
    description: "Active, bench, injured list, and minor-league roster slot counts.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "lineupLockMode",
    label: "Lineup Lock",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: "daily",
    options: lineupLockModes,
    description: "When active lineup slots lock for scoring changes.",
    commissionerEditable: true,
  },
  {
    key: "inningsMinimumPerMatchup",
    label: "Minimum Innings",
    kind: "number",
    appliesTo: ["h2h-categories"],
    defaultValue: 7,
    min: 0,
    max: 50,
    description: "Minimum pitching innings required to win ratio pitching categories in a matchup.",
    commissionerEditable: true,
  },
  {
    key: "waiverMode",
    label: "Waiver Mode",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: "rolling",
    options: waiverModes,
    description: "Free-agent acquisition mode: rolling priority or FAAB budget.",
    commissionerEditable: true,
  },
  {
    key: "faabBudget",
    label: "FAAB Budget",
    kind: "number",
    appliesTo: allScoringTypes,
    defaultValue: 100,
    min: 0,
    max: 1000,
    description: "Season budget used when FAAB waivers are enabled.",
    commissionerEditable: true,
  },
  {
    key: "waiverProcessingDays",
    label: "Waiver Processing Days",
    kind: "multi-enum",
    appliesTo: allScoringTypes,
    defaultValue: [0, 1, 2, 3, 4, 5, 6],
    options: [0, 1, 2, 3, 4, 5, 6],
    description: "Days of the week when pending waiver claims are processed.",
    commissionerEditable: true,
  },
  {
    key: "tradeReview",
    label: "Trade Review",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: "league-vote",
    options: tradeReviewModes,
    description: "Who can review or veto accepted trades before processing.",
    commissionerEditable: true,
  },
  {
    key: "tradeReviewDays",
    label: "Trade Review Days",
    kind: "number",
    appliesTo: allScoringTypes,
    defaultValue: 2,
    min: 0,
    max: 7,
    description: "Review period after a trade is accepted.",
    commissionerEditable: true,
  },
  {
    key: "playoffTeamCount",
    label: "Playoff Teams",
    kind: "number",
    appliesTo: ["h2h-categories", "h2h-points"],
    defaultValue: 6,
    min: 2,
    max: 12,
    description: "Number of teams that qualify for head-to-head playoffs.",
    commissionerEditable: true,
  },
  {
    key: "draftType",
    label: "Draft Type",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: "snake",
    options: draftTypes,
    description: "Draft format used to form initial rosters.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "playerPool",
    label: "Player Pool",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: "all",
    options: playerPools,
    description: "Draftable player universe: all MLB players, AL-only, or NL-only.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "draftPickSeconds",
    label: "Draft Pick Clock",
    kind: "enum",
    appliesTo: allScoringTypes,
    defaultValue: 60,
    options: draftPickSecondsOptions,
    description: "Seconds each manager has to make a draft pick before auto-pick.",
    commissionerEditable: true,
    locksAfterDraft: true,
  },
  {
    key: "allowNA",
    label: "NA Slots",
    kind: "boolean",
    appliesTo: allScoringTypes,
    defaultValue: false,
    description: "Whether minor-league or not-active players can be moved into NA slots.",
    commissionerEditable: true,
  },
  {
    key: "allowILPlus",
    label: "IL+ Eligibility",
    kind: "boolean",
    appliesTo: allScoringTypes,
    defaultValue: false,
    description: "Whether day-to-day players can be held in expanded injured slots.",
    commissionerEditable: true,
  },
];

export function getSettingsForScoringType(scoringType: LeagueScoringType) {
  return commissionerSettingsMatrix.filter((setting) => setting.appliesTo.includes(scoringType));
}
