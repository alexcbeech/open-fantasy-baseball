import { createHash } from "crypto";
import { getPool, isDatabaseConfigured } from "@/lib/db/client";

export const hashBotToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type BotPrincipal = { teamId: string; leagueId: string; tokenHash: string };

// Separate credential namespace: these tokens cannot authenticate ordinary REST/MCP tools.
export async function authenticateBot(header: string | null): Promise<BotPrincipal | null> {
  const match = header?.match(/^Bearer (ofb_bot_[A-Za-z0-9_-]{43})$/i);
  if (!match || !isDatabaseConfigured()) return null;
  const tokenHash = hashBotToken(match[1]);
  const result = await getPool().query<{ team_id: string; league_id: string }>(
    `select b.team_id, ft.league_id from ai_bot_manager b
     join fantasy_team ft on ft.id = b.team_id
     where b.token_hash = $1 and b.token_expires_at > now() and ft.is_bot`, [tokenHash],
  );
  const row = result.rows[0];
  return row ? { teamId: row.team_id, leagueId: row.league_id, tokenHash } : null;
}
