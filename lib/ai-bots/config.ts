import { randomBytes } from "crypto";
import { getPool } from "@/lib/db/client";
import { hashBotToken } from "./access";
import type { BotConfig, BotManagerView } from "./schema";

export async function listBotManagers(leagueId: string): Promise<BotManagerView[]> {
  const result = await getPool().query(
    `select ft.id, ft.name, b.model, b.strategy, b.enabled, b.allow_trades,
       b.token_hash is not null and b.token_expires_at > now() as has_token, b.token_expires_at
     from fantasy_team ft left join ai_bot_manager b on b.team_id = ft.id
     where ft.league_id = $1 and ft.is_bot order by ft.name`, [leagueId],
  );
  return result.rows.map((row) => ({ teamId: row.id, name: row.name, model: row.model ?? "", strategy: row.strategy ?? "",
    enabled: row.enabled ?? false, allowTrades: row.allow_trades ?? false, hasToken: row.has_token ?? false,
    tokenExpiresAt: row.token_expires_at?.toISOString() ?? null }));
}

export async function configureBot(leagueId: string, config: BotConfig) {
  const result = await getPool().query(
    `insert into ai_bot_manager(team_id, model, strategy, enabled, allow_trades)
     select id, $3, $4, $5, $6 from fantasy_team where id = $1 and league_id = $2 and is_bot
       and (not $5 or exists (select 1 from ai_bot_manager where team_id = $1 and token_hash is not null and token_expires_at > now()))
     on conflict (team_id) do update set model = excluded.model, strategy = excluded.strategy,
       enabled = excluded.enabled, allow_trades = excluded.allow_trades, updated_at = now()
     where not excluded.enabled or (ai_bot_manager.token_hash is not null and ai_bot_manager.token_expires_at > now())
     returning team_id`, [config.teamId, leagueId, config.model, config.strategy, config.enabled, config.allowTrades],
  );
  if (!result.rowCount) throw new Error("Choose a bot in this league and create its connection token before enabling it.");
}

export async function changeBotToken(leagueId: string, teamId: string, revoke: boolean) {
  const token = revoke ? null : `ofb_bot_${randomBytes(32).toString("base64url")}`;
  // Rotating or revoking always pauses management, including while a scheduler is being changed.
  const result = await getPool().query(
    `insert into ai_bot_manager(team_id, token_hash, token_expires_at)
     select id, $3, case when $3::text is null then null else now() + interval '90 days' end
     from fantasy_team where id = $1 and league_id = $2 and is_bot
     on conflict (team_id) do update set token_hash = excluded.token_hash, token_expires_at = excluded.token_expires_at,
       enabled = false, updated_at = now() returning team_id`, [teamId, leagueId, token ? hashBotToken(token) : null],
  );
  if (!result.rowCount) throw new Error("Bot not found in this league.");
  return token;
}
