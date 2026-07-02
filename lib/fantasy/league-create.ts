import { z } from "zod";
import { defaultLeagueSettings } from "./defaults";
import { draftTypes, lineupLockModes, tradeReviewModes, waiverModes } from "./settings-matrix";

export const createLeagueInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  seasonYear: z.coerce.number().int().min(2024).max(2100),
  scoringType: z.enum(["h2h-categories", "h2h-points", "roto"]),
  teamCount: z.coerce.number().int().min(4).max(20),
  waiverMode: z.enum([waiverModes[0], waiverModes[1]]),
  faabBudget: z.coerce.number().int().min(0).max(1000),
  tradeReview: z.enum([tradeReviewModes[0], tradeReviewModes[1], tradeReviewModes[2]]),
  tradeReviewDays: z.coerce.number().int().min(0).max(7),
  lineupLockMode: z.enum([lineupLockModes[0], lineupLockModes[1], lineupLockModes[2]]),
  draftType: z.enum([draftTypes[0], draftTypes[1], draftTypes[2]]),
  allowNA: z.coerce.boolean().default(defaultLeagueSettings.allowNA),
  allowILPlus: z.coerce.boolean().default(defaultLeagueSettings.allowILPlus),
});

export type CreateLeagueInput = z.infer<typeof createLeagueInputSchema>;

export function buildLeagueSettingsFromInput(input: CreateLeagueInput) {
  return {
    ...defaultLeagueSettings,
    name: input.name,
    scoringType: input.scoringType,
    teamCount: input.teamCount,
    waiverMode: input.waiverMode,
    faabBudget: input.faabBudget,
    tradeReview: input.tradeReview,
    tradeReviewDays: input.tradeReviewDays,
    lineupLockMode: input.lineupLockMode,
    draftType: input.draftType,
    allowNA: input.allowNA,
    allowILPlus: input.allowILPlus,
  };
}

export const defaultCreateLeagueInput: CreateLeagueInput = {
  name: "My OFB League",
  seasonYear: new Date().getFullYear(),
  scoringType: defaultLeagueSettings.scoringType,
  teamCount: defaultLeagueSettings.teamCount,
  waiverMode: defaultLeagueSettings.waiverMode,
  faabBudget: defaultLeagueSettings.faabBudget,
  tradeReview: defaultLeagueSettings.tradeReview,
  tradeReviewDays: defaultLeagueSettings.tradeReviewDays,
  lineupLockMode: defaultLeagueSettings.lineupLockMode,
  draftType: defaultLeagueSettings.draftType,
  allowNA: defaultLeagueSettings.allowNA,
  allowILPlus: defaultLeagueSettings.allowILPlus,
};
