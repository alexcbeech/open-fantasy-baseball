import { query, withDemoFallback } from "@/lib/db/client";
import { lineup as mockLineup, teams as mockTeams } from "@/lib/fantasy/mock-data";
import type { LeagueScoringType, MatchupCategoryResult, MatchupCategoryScore, MatchupDetails } from "@/lib/fantasy/types";
import { getLineupForTeam } from "./teams";

type ActiveMatchupRow = {
  home_logo_url?: string | null;
  away_logo_url?: string | null;
  status: "active" | "final" | "scheduled";
  matchup_id: string;
  period_label: string;
  starts_at: Date | string;
  ends_at: Date | string;
  scoring_type: LeagueScoringType;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  home_score: string | number;
  away_score: string | number;
};

type CategoryScoreRow = {
  category: string;
  home_value: string | number | null;
  away_value: string | number | null;
  home_result: MatchupCategoryResult | null;
};

type PlayerScoreRow = {
  player_name: string;
  team_id: string;
  player_id: string;
  fantasy_points: string | number;
};

const mockCategoryScores: MatchupCategoryScore[] = [
  { category: "R", userValue: 27, opponentValue: 24, result: "win" },
  { category: "HR", userValue: 8, opponentValue: 8, result: "tie" },
  { category: "RBI", userValue: 25, opponentValue: 29, result: "loss" },
  { category: "SB", userValue: 7, opponentValue: 3, result: "win" },
  { category: "AVG", userValue: ".281", opponentValue: ".267", result: "win" },
  { category: "W", userValue: 3, opponentValue: 2, result: "win" },
  { category: "SV", userValue: 2, opponentValue: 4, result: "loss" },
  { category: "K", userValue: 61, opponentValue: 56, result: "win" },
  { category: "ERA", userValue: "3.12", opponentValue: "3.42", result: "win" },
  { category: "WHIP", userValue: "1.08", opponentValue: "1.13", result: "win" },
];

export async function getMatchupDetailsForTeam(teamId: string, matchupId?: string): Promise<MatchupDetails | null> {
  return withDemoFallback(
    async () => {
      const matchupResult = await query<ActiveMatchupRow>(
        `select
           m.id as matchup_id,
           m.status,
           sp.label as period_label,
           sp.starts_at,
           sp.ends_at,
           l.scoring_type,
           m.home_team_id,
           m.away_team_id,
           home.logo_url as home_logo_url, away.logo_url as away_logo_url,
           home.name as home_team_name,
           away.name as away_team_name,
           m.home_score,
           m.away_score
         from matchup m
         join scoring_period sp on sp.id = m.scoring_period_id
         join league l on l.id = m.league_id
         join fantasy_team home on home.id = m.home_team_id
         join fantasy_team away on away.id = m.away_team_id
         where (m.home_team_id = $1 or m.away_team_id = $1)
           and ${matchupId ? "m.id = $2" : "m.status = 'active'"}
         order by sp.starts_at desc
         limit 1`,
        matchupId ? [teamId, matchupId] : [teamId],
      );
      const matchup = matchupResult.rows[0];

      if (!matchup) {
        return null;
      }

      const isHome = matchup.home_team_id === teamId;
      const opponentTeamId = isHome ? matchup.away_team_id : matchup.home_team_id;
      const [categoryResult, userLineup, opponentLineup, playerScoreResult] = await Promise.all([
        matchup.scoring_type === "h2h-points"
          ? Promise.resolve({ rows: [] as CategoryScoreRow[] })
          : query<CategoryScoreRow>(
              `select score.category, score.home_value, score.away_value, score.home_result
               from matchup_category_score score
               join matchup m on m.id = score.matchup_id
               join league_stat_category category
                 on category.league_id = m.league_id
                and category.category = score.category
               where score.matchup_id = $1
               order by category.side, category.sort_order`,
              [matchup.matchup_id],
            ),
        matchup.status === "final" || matchup.status === "scheduled" ? Promise.resolve([]) : getLineupForTeam(teamId),
        matchup.status === "final" || matchup.status === "scheduled" ? Promise.resolve([]) : getLineupForTeam(opponentTeamId),
        query<PlayerScoreRow>(
          `select score.team_id, score.player_id, score.fantasy_points, p.full_name as player_name
           from matchup_player_score score
           join player p on p.id = score.player_id
           where score.matchup_id = $1
           order by p.full_name, score.player_id`,
          [matchup.matchup_id],
        ),
      ]);
      const userPlayerPoints: Record<string, number> = {};
      const opponentPlayerPoints: Record<string, number> = {};
      for (const row of playerScoreResult.rows) {
        const target = row.team_id === teamId ? userPlayerPoints : opponentPlayerPoints;
        target[row.player_id] = Number(row.fantasy_points);
      }

      return {
        matchupId: matchup.matchup_id,
        periodLabel: matchup.period_label,
        scoringType: matchup.scoring_type,
        userTeam: {
          id: teamId,
          teamName: isHome ? matchup.home_team_name : matchup.away_team_name,
          logoUrl: (isHome ? matchup.home_logo_url : matchup.away_logo_url) ?? null,
        },
        opponentTeam: {
          id: opponentTeamId,
          teamName: isHome ? matchup.away_team_name : matchup.home_team_name,
          logoUrl: (isHome ? matchup.away_logo_url : matchup.home_logo_url) ?? null,
        },
        userScore: toNumber(isHome ? matchup.home_score : matchup.away_score),
        opponentScore: toNumber(isHome ? matchup.away_score : matchup.home_score),
        // A real matchup with no scored categories yet is empty, not mock.
        categoryScores: categoryResult.rows.map((row) => mapCategoryScore(row, isHome)),
        userLineup: withMatchupTotals(userLineup, userPlayerPoints),
        opponentLineup: withMatchupTotals(opponentLineup, opponentPlayerPoints),
        userPlayerScores: mapPlayerScores(playerScoreResult.rows, teamId),
        opponentPlayerScores: mapPlayerScores(playerScoreResult.rows, opponentTeamId),
      };
    },
    async () => mockMatchupDetails(teamId),
  );
}

function mapPlayerScores(rows: PlayerScoreRow[], teamId: string) {
  return rows.filter((row) => row.team_id === teamId).map((row) => ({
    playerId: row.player_id,
    playerName: row.player_name,
    points: Number(row.fantasy_points),
  }));
}

function withMatchupTotals(lineup: MatchupDetails["userLineup"], points: Record<string, number>) {
  return lineup.map((entry) => ({
    ...entry,
    matchupTotal: points[entry.player.id] ?? 0,
  }));
}

function mockMatchupDetails(teamId: string): MatchupDetails | null {
  const team = mockTeams.find((candidate) => candidate.id === teamId) ?? mockTeams[0];

  if (!team) {
    return null;
  }

  return {
    matchupId: "mock-matchup",
    periodLabel: team.matchup.periodLabel,
    scoringType: team.scoringType,
    userTeam: { id: team.id, teamName: team.teamName },
    opponentTeam: { id: "mock-opponent", teamName: team.matchup.opponentName },
    userScore: team.matchup.userScore,
    opponentScore: team.matchup.opponentScore,
    categoryScores: mockCategoryScores,
    userLineup: mockLineup,
    opponentLineup: mockLineup.slice().reverse(),
    userPlayerScores: mockLineup.map((entry) => ({ playerId: entry.player.id, playerName: entry.player.name, points: entry.matchupTotal })),
    opponentPlayerScores: mockLineup.slice().reverse().map((entry) => ({ playerId: entry.player.id, playerName: entry.player.name, points: entry.matchupTotal })),
  };
}

function mapCategoryScore(row: CategoryScoreRow, isHome: boolean): MatchupCategoryScore {
  const homeResult = row.home_result ?? "tie";

  return {
    category: row.category,
    userValue: displayValue(isHome ? row.home_value : row.away_value),
    opponentValue: displayValue(isHome ? row.away_value : row.home_value),
    result: isHome ? homeResult : flipResult(homeResult),
  };
}

function flipResult(result: MatchupCategoryResult): MatchupCategoryResult {
  if (result === "win") {
    return "loss";
  }

  if (result === "loss") {
    return "win";
  }

  return "tie";
}

function displayValue(value: string | number | null) {
  if (value === null) {
    return "-";
  }

  const numeric = typeof value === "number" ? value : Number.parseFloat(value);

  if (Number.isNaN(numeric)) {
    return value;
  }

  return Number.isInteger(numeric) ? numeric : numeric.toFixed(3).replace(/^0/, "");
}

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number.parseFloat(value);
}
