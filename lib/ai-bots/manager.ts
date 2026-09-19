import { getPool } from "@/lib/db/client";
import { getLeagueOverview, getLeagueSettings } from "@/lib/data/leagues";
import { getLineupForTeam, getTeamSummary, saveLineupSlots } from "@/lib/data/teams";
import { getPlayerDetail, listPlayers } from "@/lib/data/players";
import { getWeeklyPlayerAdds } from "@/lib/data/weekly-player-adds";
import { applyPlayerManagementAction } from "@/lib/data/player-actions";
import { listTradesForLeague, proposeTrade } from "@/lib/data/trades";
import { recordAuditEvent } from "@/lib/data/audit";
import { lineupToday } from "@/lib/fantasy/lineup-date";
import type { ApiIdentity } from "@/lib/auth/api-identity";
import type { BotPrincipal } from "./access";
import type { BotDecision } from "./schema";
import { getBotCoordinatorPool } from "./coordinator";

export async function getBotContext(principal: BotPrincipal) {
  const pool = getPool();
  const [team, lineup, settings, league, adds, config, decisions, claims, balance, freshness] = await Promise.all([
    getTeamSummary(principal.teamId), getLineupForTeam(principal.teamId), getLeagueSettings(principal.leagueId),
    getLeagueOverview(principal.leagueId), getWeeklyPlayerAdds(pool, principal.leagueId, principal.teamId),
    pool.query("select model, strategy, enabled, allow_trades from ai_bot_manager where team_id = $1", [principal.teamId]),
    pool.query("select request_id, model, reason, command, status, result, created_at from ai_bot_decision where team_id = $1 order by created_at desc limit 30", [principal.teamId]),
    pool.query("select id, add_player_id, drop_player_id, bid_amount, process_after from waiver_claim where team_id = $1 and status = 'pending'", [principal.teamId]),
    pool.query("select faab_remaining, waiver_priority, manager_user_id from fantasy_team where id = $1", [principal.teamId]),
    pool.query("select source, job_type, status, finished_at from ingestion_run order by started_at desc limit 12"),
  ]);
  const identity = { userId: balance.rows[0].manager_user_id, email: "", botTeamId: principal.teamId };
  const trades = await listTradesForLeague(principal.leagueId, identity);
  return { asOf: new Date().toISOString(), lineupDate: lineupToday(), team, lineup, settings, league,
    weeklyAdds: adds, config: config.rows[0], decisions: decisions.rows, pendingClaims: claims.rows,
    faabRemaining: balance.rows[0].faab_remaining, waiverPriority: balance.rows[0].waiver_priority,
    trades: trades.filter((trade) => trade.fromTeam.id === principal.teamId || trade.toTeam.id === principal.teamId),
    dataFreshness: freshness.rows };
}

export async function searchBotPlayers(principal: BotPrincipal, filters: { query?: string; availability?: "rostered" | "free-agent" | "waivers"; offset: number; limit: number }) {
  // Explicit league scope is essential: availability and the player pool differ by league.
  const players = await listPlayers({ ...filters, leagueId: principal.leagueId, limit: filters.limit + 1 });
  return { players: players.slice(0, filters.limit), nextOffset: players.length > filters.limit ? filters.offset + filters.limit : null };
}

async function executeCommand(principal: BotPrincipal, decision: BotDecision, identity: ApiIdentity, allowTrades: boolean) {
  const command = decision.command;
  switch (command.kind) {
    case "note": return { note: command.note };
    case "lineup": {
      const [settings, lineup] = await Promise.all([getLeagueSettings(principal.leagueId), getLineupForTeam(principal.teamId)]);
      for (const entry of command.entries) {
        if (entry.slot === "NA" && !settings.allowNA) throw new Error("NA is disabled in this league.");
        if (entry.slot === "IL" && !settings.allowILPlus && lineup.find((p) => p.player.id === entry.playerId)?.player.status === "day-to-day") {
          throw new Error("Day-to-day players require IL+.");
        }
      }
      await saveLineupSlots(principal.teamId, command.entries);
      return { saved: true, entries: command.entries };
    }
    case "player": {
      const player = await applyPlayerManagementAction(principal.teamId, command.playerId, command.action, { bid: command.bid, dropPlayerId: command.dropPlayerId });
      return { action: command.action, playerId: player.id, playerName: player.name };
    }
    case "propose-trade":
      if (!allowTrades) throw new Error("Trade proposals are disabled for this bot.");
      if (command.toTeamId === principal.teamId) throw new Error("Choose another team for a trade.");
      return proposeTrade(principal.leagueId, { ...command, fromTeamId: principal.teamId }, identity);
  }
}

export async function getBotPlayer(principal: BotPrincipal, playerId: string) {
  return getPlayerDetail(playerId, principal.teamId);
}

export async function getBotOpponent(principal: BotPrincipal, teamId: string) {
  const membership = await getPool().query("select 1 from fantasy_team where id = $1 and league_id = $2", [teamId, principal.leagueId]);
  if (!membership.rows.length) throw new Error("Opponent must belong to your assigned league.");
  const [team, lineup] = await Promise.all([getTeamSummary(teamId), getLineupForTeam(teamId)]);
  return { team, lineup };
}

export async function makeBotDecision(principal: BotPrincipal, decision: BotDecision) {
  const pool = getPool();
  const lock = await getBotCoordinatorPool().connect();
  try {
    await lock.query("begin");
    await lock.query("set local lock_timeout = '5s'");
    // Hold the configuration row throughout the action: parallel runs and pause/rotate
    // cannot race execution. NO KEY UPDATE lets the durable receipt's FK take KEY SHARE.
    const state = await lock.query<{ enabled: boolean; model: string; allow_trades: boolean; manager_user_id: string; league_status: string }>(
      `select b.enabled, b.model, b.allow_trades, ft.manager_user_id, l.status as league_status
       from ai_bot_manager b join fantasy_team ft on ft.id = b.team_id join league l on l.id = ft.league_id
       where b.team_id = $1 and ft.league_id = $2 and ft.is_bot and b.token_hash = $3 and b.token_expires_at > now()
       for no key update of b`, [principal.teamId, principal.leagueId, principal.tokenHash],
    );
    const config = state.rows[0];
    if (!config) throw new Error("Bot credential is no longer valid.");
    const previous = await pool.query("select command, reason, status, result from ai_bot_decision where team_id = $1 and request_id = $2", [principal.teamId, decision.requestId]);
    if (previous.rows[0]) {
      const row = previous.rows[0];
      // jsonb key order differs from JavaScript; compare canonically in SQL.
      const same = await pool.query("select command = $3::jsonb and reason = $4 as same from ai_bot_decision where team_id = $1 and request_id = $2",
        [principal.teamId, decision.requestId, JSON.stringify(decision.command), decision.reason]);
      if (!same.rows[0]?.same) throw new Error("Request ID was already used for a different decision.");
      return { requestId: decision.requestId, status: row.status, result: row.result, replayed: true };
    }
    if (!config.enabled) throw new Error("This AI manager is paused. Read context to plan; enable it before making decisions.");
    if (!["active", "playoffs"].includes(config.league_status)) throw new Error("AI management is available only during the season.");
    const usage = await pool.query("select count(*) as used from ai_bot_decision where team_id = $1 and created_at >= now() - interval '24 hours'", [principal.teamId]);
    if (Number(usage.rows[0].used) >= 40) throw new Error("Bot decision limit reached (40 per 24 hours).");
    // Commit receipt independently before touching the roster. A crash leaves a
    // pending/uncertain receipt; clients must inspect actual state, never blindly retry.
    await pool.query("insert into ai_bot_decision(team_id, request_id, model, reason, command) values ($1, $2, $3, $4, $5::jsonb)",
      [principal.teamId, decision.requestId, config.model, decision.reason, JSON.stringify(decision.command)]);
    let result: unknown;
    let status = "completed";
    try {
      result = await executeCommand(principal, decision, { userId: config.manager_user_id, email: "", botTeamId: principal.teamId }, config.allow_trades);
    } catch (error) {
      // Some shared services can fail after committing. Do not promise rollback.
      status = "uncertain";
      result = { error: error instanceof Error ? error.message : "Decision failed; inspect current team state before retrying." };
    }
    await pool.query("update ai_bot_decision set status = $3, result = $4::jsonb where team_id = $1 and request_id = $2",
      [principal.teamId, decision.requestId, status, JSON.stringify(result)]);
    await recordAuditEvent({ action: "bot.decision", entityType: "team", entityId: principal.teamId, teamId: principal.teamId,
      leagueId: principal.leagueId, detail: { requestId: decision.requestId, model: config.model, kind: decision.command.kind, reason: decision.reason, status } });
    return { requestId: decision.requestId, status, result, replayed: false };
  } finally {
    await lock.query("rollback").catch(() => undefined);
    lock.release();
  }
}
