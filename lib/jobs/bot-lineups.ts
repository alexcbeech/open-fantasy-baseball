import { getLeagueSettings } from "@/lib/data/leagues";
import { recordAuditEvent } from "@/lib/data/audit";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { getLineupForTeam, LineupSaveError, saveLineupSlots } from "@/lib/data/teams";
import { getPool } from "@/lib/db/client";
import {
  findLineupLockIssues,
  isLineupFirstGameLocked,
  isPlayerGameLocked,
  validateLineup,
} from "@/lib/fantasy/roster-validation";
import { planActiveLineup } from "@/lib/fantasy/start-active-players";
import type { LineupLockMode, LineupPlayer, RosterSlot } from "@/lib/fantasy/types";

export type BotLineupUpdate =
  | { kind: "locked" }
  | { kind: "unchanged" }
  | { kind: "invalid"; message: string }
  | { kind: "update"; entries: Array<{ playerId: string; slot: RosterSlot }> };

export type BotLineupSummary = {
  startedAt: string;
  finishedAt: string;
  botTeamsSeen: number;
  optedInTeamsSeen: number;
  teamsUpdated: number;
  playersMoved: number;
  teamsSkipped: Array<{ teamId: string; reason: string }>;
};

/**
 * Decide a bot team's lineup change for today: run the same Start Active
 * Players planner a manager gets from the lineup button, honoring the
 * league's lock mode. Pure so it can be tested without a database; returns
 * only the entries whose slot actually changes.
 */
export function computeBotLineupUpdate(lineup: LineupPlayer[], lockMode: LineupLockMode, now = new Date(), rosterSlots = defaultRosterSlots): BotLineupUpdate {
  if (!lineup.length) {
    return { kind: "unchanged" };
  }

  if (lockMode === "first-game" && isLineupFirstGameLocked(lineup, now)) {
    return { kind: "locked" };
  }

  const lockedPlayerIds = new Set(
    lineup.filter((entry) => isPlayerGameLocked(entry.player, now)).map((entry) => entry.player.id),
  );
  const next = planActiveLineup(lineup, lockedPlayerIds, rosterSlots);
  const entries = lineup
    .filter((entry) => next[entry.player.id] !== undefined && next[entry.player.id] !== entry.slot)
    .map((entry) => ({ playerId: entry.player.id, slot: next[entry.player.id] }));

  if (!entries.length) {
    return { kind: "unchanged" };
  }

  // Revalidate the full resulting lineup exactly like the lineup API would,
  // so a planner edge case can never persist an illegal or locked move.
  const proposedLineup = lineup.map((entry) => ({ ...entry, slot: next[entry.player.id] ?? entry.slot }));
  const validation = validateLineup(proposedLineup, rosterSlots, lineup);
  const lockIssues = findLineupLockIssues(lineup, proposedLineup, now, lockMode);

  if (!validation.valid || lockIssues.length) {
    const message = lockIssues[0]?.message ?? validation.issues[0]?.message ?? "invalid lineup";
    return { kind: "invalid", message };
  }

  return { kind: "update", entries };
}

/**
 * Daily lineup pass: bots and opted-in manager teams in an in-season league get the
 * Start Active Players treatment. Idempotent — a second run finds nothing
 * left to move — and per-team failures are recorded, not fatal, so one bad
 * roster can't strand the rest of the fleet.
 */
export async function setBotLineups(now = new Date()): Promise<BotLineupSummary> {
  const startedAt = new Date().toISOString();
  const summary: Omit<BotLineupSummary, "startedAt" | "finishedAt"> = {
    botTeamsSeen: 0,
    optedInTeamsSeen: 0,
    teamsUpdated: 0,
    playersMoved: 0,
    teamsSkipped: [],
  };

  const teams = await getPool().query<{ id: string; league_id: string; is_bot: boolean }>(
    `select ft.id, ft.league_id, ft.is_bot
     from fantasy_team ft
     join league l on l.id = ft.league_id
     where (ft.is_bot or ft.auto_start_active) and l.status in ('active', 'playoffs')
       and not exists (select 1 from ai_bot_manager b where b.team_id = ft.id
         and ft.is_bot and b.enabled and b.token_hash is not null and b.token_expires_at > now())
     order by ft.league_id, ft.id`,
  );
  summary.botTeamsSeen = teams.rows.filter((team) => team.is_bot).length;
  summary.optedInTeamsSeen = teams.rows.filter((team) => !team.is_bot).length;

  const settingsByLeague = new Map<string, Awaited<ReturnType<typeof getLeagueSettings>>>();

  for (const team of teams.rows) {
    try {
      let settings = settingsByLeague.get(team.league_id);
      if (!settings) {
        settings = await getLeagueSettings(team.league_id);
        settingsByLeague.set(team.league_id, settings);
      }

      const lineup = await getLineupForTeam(team.id);
      const update = computeBotLineupUpdate(lineup, settings.lineupLockMode ?? "daily", now, settings.rosterSlots);

      if (update.kind === "update") {
        await saveLineupSlots(team.id, update.entries);
        await recordAuditEvent({ action: "lineup.auto_start", entityType: "team", entityId: team.id, teamId: team.id, leagueId: team.league_id, detail: { entries: update.entries } });
        summary.teamsUpdated += 1;
        summary.playersMoved += update.entries.length;
      } else if (update.kind !== "unchanged") {
        summary.teamsSkipped.push({
          teamId: team.id,
          reason: update.kind === "locked" ? "lineup locked" : update.message,
        });
      }
    } catch (error) {
      summary.teamsSkipped.push({
        teamId: team.id,
        reason: error instanceof LineupSaveError ? error.message : `unexpected error: ${(error as Error).message}`,
      });
    }
  }

  return { startedAt, finishedAt: new Date().toISOString(), ...summary };
}
