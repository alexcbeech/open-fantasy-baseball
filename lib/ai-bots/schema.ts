import { z } from "zod";

export const botConfigSchema = z.object({
  teamId: z.uuid(),
  model: z.string().trim().max(120),
  strategy: z.string().trim().max(4000),
  enabled: z.boolean(),
  allowTrades: z.boolean(),
}).strict().refine((config) => !config.enabled || config.model.length > 0, "Choose a model before enabling this bot.");

const slot = z.enum(["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "P", "BN", "IL", "NA"]);
export const botCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lineup"), entries: z.array(z.object({ playerId: z.uuid(), slot }).strict()).min(1).max(100) }).strict(),
  z.object({ kind: z.literal("player"), playerId: z.uuid(), action: z.enum(["add", "drop", "move-to-il", "move-to-na", "claim", "cancel-claim"]),
    bid: z.number().int().min(0).max(100000).optional(), dropPlayerId: z.uuid().optional() }).strict(),
  z.object({ kind: z.literal("propose-trade"), toTeamId: z.uuid(), offeredPlayerIds: z.array(z.uuid()).min(1).max(30),
    requestedPlayerIds: z.array(z.uuid()).min(1).max(30), fromDropPlayerIds: z.array(z.uuid()).max(30).optional() }).strict(),
  z.object({ kind: z.literal("note"), note: z.string().trim().min(1).max(4000) }).strict(),
]);
export const botDecisionSchema = z.object({
  requestId: z.uuid(), reason: z.string().trim().min(1).max(2000), command: botCommandSchema,
}).strict();
export type BotDecision = z.infer<typeof botDecisionSchema>;
export type BotConfig = z.infer<typeof botConfigSchema>;
export type BotManagerView = {
  teamId: string; name: string; model: string; strategy: string; enabled: boolean;
  allowTrades: boolean; hasToken: boolean; tokenExpiresAt: string | null;
};
