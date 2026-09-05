import { query, withDemoFallback } from "@/lib/db/client";
import { teams } from "@/lib/fantasy/mock-data";
import { getMatchupDetailsForTeam } from "./matchups";

export type MatchupPeriod = {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "active" | "final";
};

export type LeagueMatchup = {
  home_logo_url?: string | null;
  away_logo_url?: string | null;
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  home_score: number | string;
  away_score: number | string;
  status: MatchupPeriod["status"];
};

export function selectPeriod(periods: MatchupPeriod[], requested?: string) {
  return periods.find((period) => period.id === requested)
    ?? periods.find((period) => period.status === "active")
    ?? periods.find((period) => period.status === "scheduled")
    ?? periods.at(-1);
}

export async function getMatchupBrowser(leagueId: string, teamId: string, periodId?: string, matchupId?: string) {
  const periods = await withDemoFallback(async () => {
    const result = await query<MatchupPeriod>(
      `select id, label, starts_at::text, ends_at::text, status from scoring_period
       where league_id = $1 order by starts_at, id`, [leagueId],
    );
    return result.rows;
  }, () => [12, 13, 14].map((week): MatchupPeriod => ({
    id: `demo-week-${week}`, label: `Week ${week}`, starts_at: `2026-06-${week === 12 ? "15" : week === 13 ? "22" : "29"}T00:00:00Z`,
    ends_at: week === 14 ? "2026-07-06T00:00:00Z" : `2026-06-${week === 12 ? "22" : "29"}T00:00:00Z`,
    status: week === 12 ? "final" : week === 13 ? "active" : "scheduled",
  })));
  const period = selectPeriod(periods, periodId);
  const matchups = period ? await withDemoFallback(async () => {
    const result = await query<LeagueMatchup>(
      `select m.id, m.home_team_id, m.away_team_id, home.name as home_name, away.name as away_name,
              home.logo_url as home_logo_url, away.logo_url as away_logo_url,
              m.home_score, m.away_score, m.status
       from matchup m
       join fantasy_team home on home.id = m.home_team_id
       join fantasy_team away on away.id = m.away_team_id
       where m.league_id = $1 and m.scoring_period_id = $2
       order by home.name, m.id`, [leagueId, period.id],
    );
    return result.rows;
  }, (): LeagueMatchup[] => {
    const team = teams.find((entry) => entry.id === teamId) ?? teams[0];
    return [
      { id: `${period.id}-1`, home_team_id: teamId, away_team_id: "demo-opponent", home_name: team.teamName,
        away_name: team.matchup.opponentName, home_score: 6, away_score: 4, status: period.status },
      { id: `${period.id}-2`, home_team_id: "demo-rivals", away_team_id: "demo-sluggers", home_name: "Moon Shots",
        away_name: "Basepath Bandits", home_score: 3, away_score: 7, status: period.status },
    ];
  }) : [];
  // Resolve requested IDs only against the authorized league and selected period.
  const selected = matchups.find((matchup) => matchup.id === matchupId)
    ?? matchups.find((matchup) => matchup.home_team_id === teamId || matchup.away_team_id === teamId)
    ?? matchups[0];
  const perspective = selected?.away_team_id === teamId ? teamId : selected?.home_team_id;
  const details = selected && perspective && period ? await withDemoFallback(
    () => getMatchupDetailsForTeam(perspective, selected.id),
    async () => {
      const base = await getMatchupDetailsForTeam(teamId);
      if (!base) return null;
      const home = perspective === selected.home_team_id;
      return {
        ...base,
        matchupId: selected.id,
        periodLabel: period.label,
        userScore: Number(home ? selected.home_score : selected.away_score),
        opponentScore: Number(home ? selected.away_score : selected.home_score),
        userTeam: { id: perspective, teamName: home ? selected.home_name : selected.away_name },
        opponentTeam: {
          id: home ? selected.away_team_id : selected.home_team_id,
          teamName: home ? selected.away_name : selected.home_name,
        },
      };
    },
  ) : null;
  return { periods, period, matchups, selected, details };
}
