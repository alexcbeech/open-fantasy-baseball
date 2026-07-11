import { query, tryDatabase } from "@/lib/db/client";
import type { LiveMatchupUpdate, MatchupCategoryResult } from "@/lib/fantasy/types";
import { compareCategory, computeCategoryValue, periodLineupStats } from "./matchup-scoring";
import { getLiveLinesForPlayers, type LiveLineupEntry, type LivePlayerRef } from "./mlb-live";

type StatMap = Record<string, number | string>;
type ActiveRow = LivePlayerRef;

const notLive: LiveMatchupUpdate = { live: false, userScore: 0, opponentScore: 0, categoryScores: [], livePoints: {} };

// Match the stored matchup_category_score display: counting totals stay
// integers, rate categories render as three decimals with the leading 0 dropped
// (".271", "3.64"). A null (rate category with no denominator) renders as "-".
function formatValue(value: number | null): number | string {
  if (value === null) {
    return "-";
  }
  return Number.isInteger(value) ? value : value.toFixed(3).replace(/^0/, "");
}

function flipResult(result: MatchupCategoryResult): MatchupCategoryResult {
  if (result === "win") return "loss";
  if (result === "loss") return "win";
  return "tie";
}

// Active starters for a team with their MLB identifiers, for live-line lookup.
async function activeLineupRows(teamId: string): Promise<ActiveRow[]> {
  const result = await query<{ id: string; mlb_player_id: number | null; current_mlb_team_id: number | null }>(
    `select p.id, p.mlb_player_id, p.current_mlb_team_id
     from lineup_entry le
     join player p on p.id = le.player_id
     where le.team_id = $1
       and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
       and le.slot not in ('BN', 'IL', 'NA')`,
    [teamId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    mlb_player_id: row.mlb_player_id ?? 0,
    current_mlb_team_id: row.current_mlb_team_id ?? 0,
  }));
}

/**
 * Assemble the live category battle from both sides' completed game lines for
 * the scoring period (the same lines the stored recompute aggregates) plus any
 * live in-game lines. The live line is appended as an extra stat entry per
 * player so counting categories sum and rate categories (AVG/ERA/WHIP) stay
 * correct — computeCategoryValue rebuilds rates from summed components. Pure and
 * side-effect free so it can be unit-tested without the DB or MLB API.
 */
export function buildLiveMatchupUpdate(
  isHome: boolean,
  categories: string[],
  homePeriodStats: StatMap[],
  awayPeriodStats: StatMap[],
  homeActive: ActiveRow[],
  awayActive: ActiveRow[],
  live: Record<string, LiveLineupEntry>,
): LiveMatchupUpdate {
  if (!Object.keys(live).length) {
    return notLive;
  }

  // The period's completed game lines, plus a live line for any current
  // starter in a game right now — summed together per category.
  const withLive = (periodStats: StatMap[], rows: ActiveRow[]) =>
    periodStats.concat(rows.filter((row) => live[row.id]).map((row) => live[row.id].stats));
  const homeStats = withLive(homePeriodStats, homeActive);
  const awayStats = withLive(awayPeriodStats, awayActive);

  let homeWins = 0;
  let awayWins = 0;
  const categoryScores = categories.map((category) => {
    const homeValue = computeCategoryValue(category, homeStats);
    const awayValue = computeCategoryValue(category, awayStats);
    const homeResult = compareCategory(category, homeValue, awayValue);
    if (homeResult === "win") homeWins += 1;
    else if (homeResult === "loss") awayWins += 1;

    return {
      category,
      userValue: formatValue(isHome ? homeValue : awayValue),
      opponentValue: formatValue(isHome ? awayValue : homeValue),
      result: isHome ? homeResult : flipResult(homeResult),
    };
  });

  const livePoints: Record<string, number> = {};
  for (const [playerId, entry] of Object.entries(live)) {
    livePoints[playerId] = entry.points;
  }

  return {
    live: true,
    userScore: isHome ? homeWins : awayWins,
    opponentScore: isHome ? awayWins : homeWins,
    categoryScores,
    livePoints,
  };
}

/**
 * Recompute a team's active matchup category battle from each side's scoring-
 * period game lines plus any live in-game lines, on demand. Returns a not-live
 * result (so callers keep the stored nightly values) whenever no active player
 * has a game in progress.
 */
export async function computeLiveMatchup(teamId: string): Promise<LiveMatchupUpdate | null> {
  return tryDatabase(
    async () => {
      const matchupResult = await query<{
        league_id: string;
        home_team_id: string;
        away_team_id: string;
        starts_at: Date | string;
        ends_at: Date | string;
      }>(
        `select m.league_id, m.home_team_id, m.away_team_id, sp.starts_at, sp.ends_at
         from matchup m
         join scoring_period sp on sp.id = m.scoring_period_id
         where (m.home_team_id = $1 or m.away_team_id = $1) and m.status = 'active'
         limit 1`,
        [teamId],
      );
      const matchup = matchupResult.rows[0];
      if (!matchup) {
        return null;
      }

      const isHome = matchup.home_team_id === teamId;
      const [categoryRows, homePeriodStats, awayPeriodStats, homeActive, awayActive] = await Promise.all([
        query<{ category: string }>(`select category from league_stat_category where league_id = $1 order by side, sort_order`, [
          matchup.league_id,
        ]),
        periodLineupStats({ query }, matchup.home_team_id, matchup.starts_at, matchup.ends_at),
        periodLineupStats({ query }, matchup.away_team_id, matchup.starts_at, matchup.ends_at),
        activeLineupRows(matchup.home_team_id),
        activeLineupRows(matchup.away_team_id),
      ]);

      const liveRefs = [...homeActive, ...awayActive].filter((row) => row.mlb_player_id && row.current_mlb_team_id);
      const live = await getLiveLinesForPlayers(liveRefs);

      return buildLiveMatchupUpdate(
        isHome,
        categoryRows.rows.map((row) => row.category),
        homePeriodStats,
        awayPeriodStats,
        homeActive,
        awayActive,
        live,
      );
    },
    () => notLive,
  );
}
