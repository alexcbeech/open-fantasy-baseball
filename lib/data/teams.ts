import { getPool, query, tryDatabase } from "@/lib/db/client";
import { lineup as mockLineup, teams as mockTeams } from "@/lib/fantasy/mock-data";
import type { LineupPlayer, RosterSlot, TeamSummary } from "@/lib/fantasy/types";
import { mapLineupPlayer, mapTeamSummary, type DbLineupRow, type DbTeamSummaryRow } from "./mappers";

const teamSummarySql = `
  select
    ft.id,
    ft.league_id,
    l.name as league_name,
    ft.name as team_name,
    u.display_name as manager_name,
    l.scoring_type,
    ft.waiver_priority as rank,
    sp.label as matchup_label,
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

export async function listTeamsForCurrentUser(): Promise<TeamSummary[]> {
  return tryDatabase(
    async () => {
      const result = await query<DbTeamSummaryRow>(`${teamSummarySql} order by ft.waiver_priority nulls last, ft.name`);
      // Empty is a valid result (a real user with no teams); only the
      // tryDatabase fallback below serves mock data (demo mode / DB error).
      return result.rows.map(mapTeamSummary);
    },
    () => mockTeams,
  );
}

export async function getTeamSummary(teamId: string): Promise<TeamSummary | undefined> {
  return tryDatabase(
    async () => {
      const result = await query<DbTeamSummaryRow>(`${teamSummarySql} where ft.id = $1`, [teamId]);
      // A missing team is undefined (callers 404), not a mock team.
      return result.rows[0] ? mapTeamSummary(result.rows[0]) : undefined;
    },
    () => mockTeams.find((team) => team.id === teamId),
  );
}

export async function getLineupForTeam(teamId: string): Promise<LineupPlayer[]> {
  return tryDatabase(
    async () => {
      const result = await query<DbLineupRow>(
        `
          select
            le.slot,
            p.id,
            p.mlb_player_id,
            p.full_name,
            mt.abbreviation as mlb_team,
            p.status,
            coalesce(array_agg(distinct ppe.position order by ppe.position) filter (where ppe.position is not null), '{}') as positions,
            null::text as news_headline,
            coalesce(season_stats.stats, '{}'::jsonb) as season_stats,
            coalesce(projection_stats.stats, '{}'::jsonb) as projected_stats,
            p.season_fan_points,
            next_game.game_date,
            next_game.home_away,
            next_game.opponent,
            todays_game.first_pitch as todays_game_start,
            0 as matchup_total
          from lineup_entry le
          join player p on p.id = le.player_id
          left join mlb_team mt on mt.id = p.current_mlb_team_id
          left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
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
              and g.game_date >= now()
            order by g.game_date asc
            limit 1
          ) next_game on true
          left join lateral (
            -- First pitch of the player's MLB game today (baseball's "today" is
            -- the ET official date). Once this passes, the lineup slot locks.
            select min(g.game_date) as first_pitch
            from mlb_game g
            where (g.home_mlb_team_id = p.current_mlb_team_id or g.away_mlb_team_id = p.current_mlb_team_id)
              and coalesce(g.official_date, (g.game_date at time zone 'America/New_York')::date)
                = (now() at time zone 'America/New_York')::date
          ) todays_game on true
          where le.team_id = $1
            and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
          group by le.id, le.slot, p.id, mt.abbreviation, season_stats.stats, projection_stats.stats,
            p.season_fan_points, next_game.game_date, next_game.home_away, next_game.opponent, todays_game.first_pitch
          order by le.lineup_date desc, le.id
        `,
        [teamId],
      );

      // An empty lineup (a real team that hasn't set one) renders as empty
      // slots; only the tryDatabase fallback serves the mock lineup.
      return result.rows.map(mapLineupPlayer);
    },
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

/**
 * Persist the team's current-day lineup slots. Entries are upserted against the
 * team's latest lineup date, so a save is a full or partial slot assignment for
 * today; validation (legality, game locks) happens in the API route before this
 * runs.
 */
export async function saveLineupSlots(teamId: string, entries: Array<{ playerId: string; slot: RosterSlot }>): Promise<void> {
  const client = await getPool().connect();

  try {
    await client.query("begin");

    const teamResult = await client.query<{ league_id: string }>("select league_id from fantasy_team where id = $1", [teamId]);
    const leagueId = teamResult.rows[0]?.league_id;

    if (!leagueId) {
      throw new LineupSaveError("Team not found.", 404);
    }

    const scoringPeriod = await client.query<{ id: string }>(
      `select id
       from scoring_period
       where league_id = $1 and status = 'active'
       order by starts_at desc
       limit 1`,
      [leagueId],
    );
    const scoringPeriodId = scoringPeriod.rows[0]?.id;

    if (!scoringPeriodId) {
      throw new LineupSaveError("No active scoring period is available.");
    }

    const latestLineupDate = await client.query<{ lineup_date: Date | string }>(
      "select coalesce(max(lineup_date), current_date) as lineup_date from lineup_entry where team_id = $1",
      [teamId],
    );
    const lineupDate = latestLineupDate.rows[0].lineup_date;

    for (const entry of entries) {
      await client.query(
        `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
         values ($1, $2, $3, $4, $5)
         on conflict (team_id, player_id, lineup_date)
         do update set slot = excluded.slot`,
        [teamId, entry.playerId, scoringPeriodId, lineupDate, entry.slot],
      );
    }

    await client.query(
      `insert into fantasy_transaction (league_id, team_id, type, status, payload, processed_at)
       values ($1, $2, 'lineup_change', 'processed', $3::jsonb, now())`,
      [leagueId, teamId, JSON.stringify({ entries })],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
