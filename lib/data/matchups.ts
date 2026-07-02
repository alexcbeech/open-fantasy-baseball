import { query, tryDatabase } from "@/lib/db/client";
import { lineup as mockLineup, teams as mockTeams } from "@/lib/fantasy/mock-data";
import type { MatchupCategoryResult, MatchupCategoryScore, MatchupDetails } from "@/lib/fantasy/types";
import { getLineupForTeam } from "./teams";

type ActiveMatchupRow = {
  matchup_id: string;
  period_label: string;
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

export async function getMatchupDetailsForTeam(teamId: string): Promise<MatchupDetails | null> {
  return tryDatabase(
    async () => {
      const matchupResult = await query<ActiveMatchupRow>(
        `select
           m.id as matchup_id,
           sp.label as period_label,
           m.home_team_id,
           m.away_team_id,
           home.name as home_team_name,
           away.name as away_team_name,
           m.home_score,
           m.away_score
         from matchup m
         join scoring_period sp on sp.id = m.scoring_period_id
         join fantasy_team home on home.id = m.home_team_id
         join fantasy_team away on away.id = m.away_team_id
         where (m.home_team_id = $1 or m.away_team_id = $1)
           and m.status = 'active'
         order by sp.starts_at desc
         limit 1`,
        [teamId],
      );
      const matchup = matchupResult.rows[0];

      if (!matchup) {
        return null;
      }

      const isHome = matchup.home_team_id === teamId;
      const opponentTeamId = isHome ? matchup.away_team_id : matchup.home_team_id;
      const [categoryResult, userLineup, opponentLineup] = await Promise.all([
        query<CategoryScoreRow>(
          `select category, home_value, away_value, home_result
           from matchup_category_score
           where matchup_id = $1
           order by category`,
          [matchup.matchup_id],
        ),
        getLineupForTeam(teamId),
        getLineupForTeam(opponentTeamId),
      ]);

      return {
        matchupId: matchup.matchup_id,
        periodLabel: matchup.period_label,
        userTeam: {
          id: teamId,
          teamName: isHome ? matchup.home_team_name : matchup.away_team_name,
        },
        opponentTeam: {
          id: opponentTeamId,
          teamName: isHome ? matchup.away_team_name : matchup.home_team_name,
        },
        userScore: toNumber(isHome ? matchup.home_score : matchup.away_score),
        opponentScore: toNumber(isHome ? matchup.away_score : matchup.home_score),
        categoryScores: categoryResult.rows.length ? categoryResult.rows.map((row) => mapCategoryScore(row, isHome)) : mockCategoryScores,
        userLineup,
        opponentLineup,
      };
    },
    async () => mockMatchupDetails(teamId),
  );
}

function mockMatchupDetails(teamId: string): MatchupDetails | null {
  const team = mockTeams.find((candidate) => candidate.id === teamId) ?? mockTeams[0];

  if (!team) {
    return null;
  }

  return {
    matchupId: "mock-matchup",
    periodLabel: team.matchup.periodLabel,
    userTeam: { id: team.id, teamName: team.teamName },
    opponentTeam: { id: "mock-opponent", teamName: team.matchup.opponentName },
    userScore: team.matchup.userScore,
    opponentScore: team.matchup.opponentScore,
    categoryScores: mockCategoryScores,
    userLineup: mockLineup,
    opponentLineup: mockLineup.slice().reverse(),
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
