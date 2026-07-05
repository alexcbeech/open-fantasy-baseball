import { query, tryDatabase } from "@/lib/db/client";
import { lineup as mockLineup, teams as mockTeams } from "@/lib/fantasy/mock-data";
import type { LineupPlayer, TeamSummary } from "@/lib/fantasy/types";
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
          where le.team_id = $1
            and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
          group by le.id, le.slot, p.id, mt.abbreviation, season_stats.stats, projection_stats.stats,
            p.season_fan_points, next_game.game_date, next_game.home_away, next_game.opponent
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
