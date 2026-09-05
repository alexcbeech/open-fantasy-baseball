import { isLineupDate, lineupToday } from "@/lib/fantasy/lineup-date";
import type { QueryResult, QueryResultRow } from "pg";
import { getPool, isUniqueViolation, query, withDemoFallback } from "@/lib/db/client";
import { lineup as mockLineup, teams as mockTeams } from "@/lib/fantasy/mock-data";
import { findLineupLockIssues, validateLineup } from "@/lib/fantasy/roster-validation";
import { formatRecord, rankStandings } from "@/lib/fantasy/season-schedule";
import type { LineupPlayer, RosterSlot, TeamSummary } from "@/lib/fantasy/types";
import { ensureFutureLineupSnapshot, ensureTodayLineupSnapshot } from "./lineup-snapshots";
import { mapLineupPlayer, mapTeamSummary, type DbLineupRow, type DbTeamSummaryRow } from "./mappers";
import { rotoStandingsForLeague } from "./roto";
import { teamRecordsForLeague } from "./season";

type Executor = { query: <T extends QueryResultRow>(sql: string, values?: unknown[]) => Promise<QueryResult<T>> };

const lineupRowsSql = `
          select
            le.slot,
            p.id,
            p.mlb_player_id,
            p.full_name,
            mt.abbreviation as mlb_team,
            p.status,
            p.status_detail,
            coalesce(array_agg(distinct ppe.position order by ppe.position) filter (where ppe.position is not null), '{}') as positions,
            null::text as news_headline,
            coalesce(season_stats.stats, '{}'::jsonb) as season_stats,
            coalesce(projection_stats.stats, '{}'::jsonb) as projected_stats,
            p.season_fan_points,
            next_game.game_date,
            next_game.home_away,
            next_game.opponent,
            todays_game.first_pitch as todays_game_start,
            todays_game.game_count as todays_game_count,
            todays_game.probable_starter as todays_probable_starter,
            team_schedule.remaining_games as remaining_team_games,
            p.bats,
            todays_game.opposing_pitcher_throws as todays_opposing_pitcher_throws,
            adp.adp,
            coalesce(matchup_score.fantasy_points, 0) as matchup_total
          from lineup_entry le
          join player p on p.id = le.player_id
          left join mlb_team mt on mt.id = p.current_mlb_team_id
          left join player_adp adp on adp.player_id = p.id
          left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
          left join lateral (
            select mps.fantasy_points
            from matchup_player_score mps
            join matchup m on m.id = mps.matchup_id
            join scoring_period sp on sp.id = m.scoring_period_id
            where mps.team_id = le.team_id
              and mps.player_id = p.id
              and m.status = 'active'
            order by sp.starts_at desc
            limit 1
          ) matchup_score on true
          left join lateral (
            select stats from player_stat_line psl where psl.player_id = p.id and split = 'season' order by stat_date desc limit 1
          ) season_stats on true
          left join lateral (
            select stats from player_stat_line psl where psl.player_id = p.id and split = 'projection_ros' order by stat_date desc limit 1
          ) projection_stats on true
          left join lateral (
            select
              g.game_date,
              case when g.home_mlb_team_id = p.current_mlb_team_id then 'home' else 'away' end as home_away,
              case when g.home_mlb_team_id = p.current_mlb_team_id then away.abbreviation else home.abbreviation end as opponent
            from mlb_game g
            left join mlb_team home on home.id = g.home_mlb_team_id
            left join mlb_team away on away.id = g.away_mlb_team_id
            where (g.home_mlb_team_id = p.current_mlb_team_id or g.away_mlb_team_id = p.current_mlb_team_id)
              and (($2::date is null and g.game_date >= now()) or
                coalesce(g.official_date, (g.game_date at time zone 'America/New_York')::date) = $2::date)
            order by g.game_date asc
            limit 1
          ) next_game on true
          left join lateral (
            -- First pitch of the player's MLB game today (baseball's "today" is
            -- the ET official date). Once this passes, the lineup slot locks.
            -- probable_starter flags pitchers listed as today's probable starter;
            -- opposing_pitcher_throws is the hand of the earliest game's opposing
            -- probable starter, for platoon-aware daily projections.
            select
              min(g.game_date) as first_pitch,
              count(*) as game_count,
              bool_or(g.home_probable_pitcher_player_id = p.id or g.away_probable_pitcher_player_id = p.id) as probable_starter,
              (array_agg(opp.throws order by g.game_date) filter (where opp.throws is not null))[1] as opposing_pitcher_throws
            from mlb_game g
            left join player opp on opp.id = case
              when g.home_mlb_team_id = p.current_mlb_team_id then g.away_probable_pitcher_player_id
              else g.home_probable_pitcher_player_id
            end
            where (g.home_mlb_team_id = p.current_mlb_team_id or g.away_mlb_team_id = p.current_mlb_team_id)
              and coalesce(g.official_date, (g.game_date at time zone 'America/New_York')::date)
                = coalesce($2::date, (now() at time zone 'America/New_York')::date)
          ) todays_game on true
          left join lateral (
            select count(*) as remaining_games
            from mlb_game g
            where (g.home_mlb_team_id = p.current_mlb_team_id or g.away_mlb_team_id = p.current_mlb_team_id)
              and coalesce(g.status, 'Preview') <> 'Final'
              and coalesce(g.official_date, (g.game_date at time zone 'America/New_York')::date)
                >= coalesce($2::date, (now() at time zone 'America/New_York')::date)
          ) team_schedule on true
          where le.team_id = $1
            and le.lineup_date = (
              select max(lineup_date)
              from lineup_entry
              where team_id = $1
                and lineup_date <= coalesce($2::date, (now() at time zone 'America/New_York')::date)
            )
          group by le.id, le.slot, p.id, mt.abbreviation, season_stats.stats, projection_stats.stats,
            p.season_fan_points, next_game.game_date, next_game.home_away, next_game.opponent, todays_game.first_pitch,
            todays_game.game_count, todays_game.probable_starter, todays_game.opposing_pitcher_throws,
            team_schedule.remaining_games, adp.adp, matchup_score.fantasy_points
          order by le.lineup_date desc, le.id
`;

async function queryLineupRows(executor: Executor, teamId: string, lineupDate?: string): Promise<LineupPlayer[]> {
  const result = await executor.query<DbLineupRow>(lineupRowsSql, [teamId, lineupDate ?? null]);
  return result.rows.map(mapLineupPlayer);
}

const teamSummarySql = `
  select
    ft.id,
    ft.league_id,
    l.name as league_name,
    ft.name as team_name,
    ft.logo_url,
    u.display_name as manager_name,
    l.scoring_type,
    sp.label as matchup_label,
    sp.starts_at as period_starts,
    sp.ends_at as period_ends,
    opponent.name as opponent_name,
    case when m.home_team_id = ft.id then m.home_score else m.away_score end as user_score,
    case when m.home_team_id = ft.id then m.away_score else m.home_score end as opponent_score
  from fantasy_team ft
  join league l on l.id = ft.league_id
  join app_user u on u.id = ft.manager_user_id
  left join matchup m on (m.home_team_id = ft.id or m.away_team_id = ft.id) and m.status = 'active'
  left join scoring_period sp on sp.id = m.scoring_period_id
  left join fantasy_team opponent on opponent.id = case when m.home_team_id = ft.id then m.away_team_id else m.home_team_id end
`;

type StandingsContext = { record: string; rank: number };

/**
 * Standings context for every team in a league. Building the whole map once is
 * important for My Teams, where several managed teams can share a league.
 */
async function standingsContextsForLeague(leagueId: string, scoringType: string | null): Promise<Map<string, StandingsContext>> {
  if (scoringType === "roto") {
    const roto = await rotoStandingsForLeague(leagueId);
    return new Map(roto.map((entry) => [entry.teamId, { record: `${entry.points} pts`, rank: entry.rank }]));
  }

  const [records, teams] = await Promise.all([
    teamRecordsForLeague(leagueId),
    query<{ id: string; name: string }>(`select id, name from fantasy_team where league_id = $1`, [leagueId]),
  ]);
  const ranked = rankStandings(
    teams.rows.map((team) => ({
      teamId: team.id,
      teamName: team.name,
      ...(records.get(team.id) ?? { wins: 0, losses: 0, ties: 0, points: 0 }),
    })),
  );
  return new Map(ranked.map((entry, index) => [entry.teamId, { record: formatRecord(entry), rank: index + 1 }]));
}

/**
 * Standings context for a team: its record string ("3-1", or roto points for
 * rotisserie leagues) and rank within the league (new leagues rank by name).
 */
async function standingsContext(leagueId: string, teamId: string, scoringType: string | null): Promise<StandingsContext> {
  const contexts = await standingsContextsForLeague(leagueId, scoringType);
  return contexts.get(teamId) ?? { record: scoringType === "roto" ? "0 pts" : "0-0", rank: 1 };
}

export async function listTeamsForCurrentUser(user?: { userId: string; email: string } | null): Promise<TeamSummary[]> {
  return withDemoFallback(
    async () => {
      if (!user) {
        return [];
      }

      // Only teams the user manages. The demo user's id is not a UUID, so
      // identity matches on id or email.
      const result = await query<DbTeamSummaryRow>(
        `${teamSummarySql}
         where u.id::text = $1 or u.email = $2
         order by ft.waiver_priority nulls last, ft.name`,
        [user.userId, user.email],
      );
      // Empty is a valid result (a real user with no teams); the demo fallback
      // below serves mock data only when no database is configured.
      const standingsByLeague = new Map<string, Promise<Map<string, StandingsContext>>>();
      for (const row of result.rows) {
        const key = `${row.league_id}:${row.scoring_type ?? ""}`;
        if (!standingsByLeague.has(key)) {
          standingsByLeague.set(key, standingsContextsForLeague(row.league_id, row.scoring_type));
        }
      }

      return Promise.all(
        result.rows.map(async (row) => {
          const contexts = await standingsByLeague.get(`${row.league_id}:${row.scoring_type ?? ""}`)!;
          const context = contexts.get(row.id) ?? { record: row.scoring_type === "roto" ? "0 pts" : "0-0", rank: 1 };
          return mapTeamSummary(row, context);
        }),
      );
    },
    () => mockTeams,
  );
}

export async function getTeamSummary(teamId: string): Promise<TeamSummary | undefined> {
  return withDemoFallback(
    async () => {
      const result = await query<DbTeamSummaryRow>(`${teamSummarySql} where ft.id = $1`, [teamId]);
      // A missing team is undefined (callers 404), not a mock team.
      const row = result.rows[0];
      return row ? mapTeamSummary(row, await standingsContext(row.league_id, row.id, row.scoring_type)) : undefined;
    },
    () => mockTeams.find((team) => team.id === teamId),
  );
}

export async function getLineupForTeam(teamId: string, lineupDate?: string): Promise<LineupPlayer[]> {
  return withDemoFallback(
    // An empty lineup (a real team that hasn't set one) renders as empty
    // slots; the demo fallback serves the mock lineup only in demo mode.
    () => queryLineupRows({ query }, teamId, lineupDate),
    () => mockLineup,
  );
}

export class LineupSaveError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export class TeamNameUpdateError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

/** Rename a fantasy team while preserving the league-level unique-name rule. */
export async function updateTeamName(teamId: string, name: string): Promise<string> {
  try {
    const result = await query<{ name: string }>(
      `update fantasy_team
       set name = $2, updated_at = now()
       where id = $1
       returning name`,
      [teamId, name],
    );

    if (!result.rows[0]) {
      throw new TeamNameUpdateError("Team not found.", 404);
    }

    return result.rows[0].name;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new TeamNameUpdateError("Another team in this league already uses that name.", 409);
    }

    throw error;
  }
}

/**
 * Persist the team's current-day lineup slots. The latest effective lineup is
 * first copied into an ET-dated snapshot, so changes today never rewrite the
 * lineup that was used to score an earlier day.
 *
 * The API route pre-validates for fast user feedback, but that check reads the
 * lineup outside this transaction. To stop two concurrent saves from each
 * passing against the same snapshot and committing an illegal lineup, this
 * serializes saves per team with an advisory lock and re-validates the full
 * resulting lineup (legality + game locks) against rows read inside the lock.
 */
export async function saveLineupSlots(teamId: string, entries: Array<{ playerId: string; slot: RosterSlot }>, lineupDate?: string): Promise<void> {
  if (lineupDate !== undefined && !isLineupDate(lineupDate)) throw new LineupSaveError("Invalid lineup date.", 400);
  if (lineupDate && lineupDate < lineupToday()) throw new LineupSaveError("Past lineups are locked.", 409);
  const client = await getPool().connect();

  try {
    await client.query("begin");
    // Serialize concurrent saves for this team; released automatically at commit
    // or rollback. hashtext maps the team id to the int the lock function takes.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [teamId]);

    const teamResult = await client.query<{
      league_id: string;
      lineup_lock_mode: string | null;
      roster_slots: Record<RosterSlot, number> | null;
    }>(
      `select ft.league_id,
              l.settings->>'lineupLockMode' as lineup_lock_mode,
              l.settings->'rosterSlots' as roster_slots
       from fantasy_team ft
       join league l on l.id = ft.league_id
       where ft.id = $1`,
      [teamId],
    );
    const leagueId = teamResult.rows[0]?.league_id;
    const lockMode = teamResult.rows[0]?.lineup_lock_mode === "first-game" ? "first-game" : "daily";
    const rosterSlots = teamResult.rows[0]?.roster_slots ?? undefined;

    if (!leagueId) {
      throw new LineupSaveError("Team not found.", 404);
    }

    // Re-read the effective lineup inside the lock and validate the whole
    // resulting lineup, so a save that raced the route's pre-check can't
    // persist a duplicate, overfilled, ineligible, or locked-player slot.
    const selectedDate = lineupDate ?? lineupToday();
    if (selectedDate < lineupToday()) throw new LineupSaveError("Past lineups are locked.", 409);
    const future = selectedDate > lineupToday();
    if (future) {
      const migration = await client.query("select 1 from schema_migration where filename = '0031_future_lineup_roster_reset.sql'");
      if (!migration.rows.length) throw new LineupSaveError("Future lineup scheduling requires the latest database migration.", 503);
    }
    const currentLineup = await queryLineupRows(client, teamId, lineupDate);
    const currentById = new Map(currentLineup.map((entry) => [entry.player.id, entry]));
    const proposedSlots = new Map(entries.map((entry) => [entry.playerId, entry.slot]));

    for (const entry of entries) {
      if (!currentById.has(entry.playerId)) {
        throw new LineupSaveError("A lineup entry references a player who is not on this team.", 409);
      }
    }

    const proposedLineup: LineupPlayer[] = currentLineup.map((entry) => ({
      slot: proposedSlots.get(entry.player.id) ?? entry.slot,
      player: entry.player,
      matchupTotal: entry.matchupTotal,
    }));
    const validation = validateLineup(proposedLineup, rosterSlots);
    const lockIssues = future ? [] : findLineupLockIssues(currentLineup, proposedLineup, new Date(), lockMode);

    if (lockIssues.length) {
      throw new LineupSaveError(lockIssues[0].message, 409);
    }

    if (!validation.valid) {
      throw new LineupSaveError(validation.issues[0]?.message ?? "The lineup is invalid.", 409);
    }

    const snapshot = future
      ? await ensureFutureLineupSnapshot(client, teamId, leagueId, selectedDate)
      : await ensureTodayLineupSnapshot(client, teamId, leagueId);

    if (!snapshot) {
      throw new LineupSaveError("No scoring period is available for the selected date.");
    }

    for (const entry of entries) {
      await client.query(
        `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
         values ($1, $2, $3, $4, $5)
         on conflict (team_id, player_id, lineup_date)
         do update set slot = excluded.slot`,
        [teamId, entry.playerId, snapshot.scoringPeriodId, snapshot.lineupDate, entry.slot],
      );
    }

    await client.query(
      `insert into fantasy_transaction (league_id, team_id, type, status, payload, processed_at)
       values ($1, $2, 'lineup_change', 'processed', $3::jsonb, now())`,
      [leagueId, teamId, JSON.stringify({ entries, lineupDate: selectedDate })],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
