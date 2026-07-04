import type { LineupPlayer, Player, PlayerNextGame, TeamSummary } from "@/lib/fantasy/types";

export type DbTeamSummaryRow = {
  id: string;
  league_id: string;
  league_name: string;
  team_name: string;
  manager_name: string;
  scoring_type: TeamSummary["scoringType"];
  rank: number | null;
  matchup_label: string | null;
  opponent_name: string | null;
  user_score: string | number | null;
  opponent_score: string | number | null;
};

export type DbPlayerRow = {
  id: string;
  mlb_player_id: number | null;
  full_name: string;
  mlb_team: string | null;
  status: Player["status"];
  positions: string[] | null;
  availability?: Player["availability"];
  news_headline?: string | null;
  season_stats?: Record<string, number | string> | null;
  projected_stats?: Record<string, number | string> | null;
  season_fan_points?: string | number | null;
  game_date?: Date | string | null;
  home_away?: "home" | "away" | null;
  opponent?: string | null;
};

export type DbLineupRow = DbPlayerRow & {
  slot: LineupPlayer["slot"];
  matchup_total: string | number | null;
};

function toNumber(value: string | number | null | undefined, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isNaN(numeric) ? fallback : numeric;
}

export function mapTeamSummary(row: DbTeamSummaryRow): TeamSummary {
  const userScore = toNumber(row.user_score);
  const opponentScore = toNumber(row.opponent_score);

  return {
    id: row.id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    teamName: row.team_name,
    managerName: row.manager_name,
    scoringType: row.scoring_type,
    record: row.scoring_type === "roto" ? "0 pts" : "0-0",
    rank: row.rank ?? 1,
    matchup: {
      opponentName: row.opponent_name ?? "Season Standings",
      userScore,
      opponentScore,
      periodLabel: row.matchup_label ?? "Season",
      progressPercent: 50,
    },
  };
}

export function mapPlayer(row: DbPlayerRow): Player {
  const nextGame: PlayerNextGame | null = row.game_date
    ? {
        date: new Date(row.game_date).toISOString(),
        opponent: row.opponent ?? null,
        homeAway: row.home_away ?? "home",
        venue: null,
      }
    : null;

  return {
    id: row.id,
    mlbPlayerId: row.mlb_player_id,
    name: row.full_name,
    mlbTeam: row.mlb_team ?? "FA",
    positions: (row.positions?.length ? row.positions : ["UTIL"]) as Player["positions"],
    status: row.status,
    availability: row.availability ?? "free-agent",
    newsHeadline: row.news_headline ?? undefined,
    seasonStats: row.season_stats ?? {},
    projectedStats: row.projected_stats ?? {},
    seasonPoints: row.season_fan_points != null ? Math.round(Number(row.season_fan_points)) : null,
    nextGame,
  };
}

export function mapLineupPlayer(row: DbLineupRow): LineupPlayer {
  return {
    slot: row.slot,
    player: mapPlayer({ ...row, availability: "rostered" }),
    matchupTotal: toNumber(row.matchup_total),
  };
}

