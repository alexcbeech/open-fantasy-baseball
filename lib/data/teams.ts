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
      return result.rows.length ? result.rows.map(mapTeamSummary) : mockTeams;
    },
    () => mockTeams,
  );
}

export async function getTeamSummary(teamId: string): Promise<TeamSummary | undefined> {
  return tryDatabase(
    async () => {
      const result = await query<DbTeamSummaryRow>(`${teamSummarySql} where ft.id = $1`, [teamId]);
      return result.rows[0] ? mapTeamSummary(result.rows[0]) : mockTeams.find((team) => team.id === teamId);
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
            '{}'::jsonb as season_stats,
            '{}'::jsonb as projected_stats,
            0 as matchup_total
          from lineup_entry le
          join player p on p.id = le.player_id
          left join mlb_team mt on mt.id = p.current_mlb_team_id
          left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
          where le.team_id = $1
            and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
          group by le.id, le.slot, p.id, mt.abbreviation
          order by le.lineup_date desc, le.id
        `,
        [teamId],
      );

      return result.rows.length ? result.rows.map(mapLineupPlayer) : mockLineup;
    },
    () => mockLineup,
  );
}
