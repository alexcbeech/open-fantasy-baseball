import { query, tryDatabase } from "@/lib/db/client";
import type { LiveMatchupUpdate, MatchupCategoryResult } from "@/lib/fantasy/types";
import { compareCategory, computeCategoryValue } from "./matchup-scoring";
import { getLiveLinesForPlayers, type LiveLineupEntry, type LivePlayerRef } from "./mlb-live";

type StatMap = Record<string, number | string>;
type ActiveRow = LivePlayerRef & { stats: StatMap };

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

// Active starters for a team with their latest season line and MLB identifiers.
async function activeLineupRows(teamId: string): Promise<ActiveRow[]> {
  const result = await query<{ id: string; mlb_player_id: number | null; current_mlb_team_id: number | null; stats: StatMap }>(
    `select p.id, p.mlb_player_id, p.current_mlb_team_id, coalesce(season_stats.stats, '{}'::jsonb) as stats
     from lineup_entry le
     join player p on p.id = le.player_id
     left join lateral (
       select stats from player_stat_line psl
       where psl.player_id = p.id and psl.split = 'season'
       order by stat_date desc limit 1
     ) season_stats on true
     where le.team_id = $1
       and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
       and le.slot not in ('BN', 'IL', 'NA')`,
    [teamId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    mlb_player_id: row.mlb_player_id ?? 0,
    current_mlb_team_id: row.current_mlb_team_id ?? 0,
    stats: row.stats,
  }));
}

/**
 * Assemble the live category battle from both sides' active season lines plus
 * any live in-game lines. The live line is appended as an extra stat entry per
 * player so counting categories sum and rate categories (AVG/ERA/WHIP) stay
 * correct — computeCategoryValue rebuilds rates from summed components. Pure and
 * side-effect free so it can be unit-tested without the DB or MLB API.
 */
export function buildLiveMatchupUpdate(
  isHome: boolean,
  categories: string[],
  homeActive: ActiveRow[],
  awayActive: ActiveRow[],
  live: Record<string, LiveLineupEntry>,
): LiveMatchupUpdate {
  if (!Object.keys(live).length) {
    return notLive;
  }

  // Season lines for every active starter, plus a live line for anyone in a
  // game right now — summed together per category.
  const withLive = (rows: ActiveRow[]) =>
    rows.map((row) => row.stats).concat(rows.filter((row) => live[row.id]).map((row) => live[row.id].stats));
  const homeStats = withLive(homeActive);
  const awayStats = withLive(awayActive);

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
 * Recompute a team's active matchup category battle from each side's season
 * stats plus any live in-game lines, on demand. Returns a not-live result (so
 * callers keep the stored nightly values) whenever no active player has a game
 * in progress.
 */
export async function computeLiveMatchup(teamId: string): Promise<LiveMatchupUpdate | null> {
  return tryDatabase(
    async () => {
      const matchupResult = await query<{ league_id: string; home_team_id: string; away_team_id: string }>(
        `select league_id, home_team_id, away_team_id
         from matchup
         where (home_team_id = $1 or away_team_id = $1) and status = 'active'
         limit 1`,
        [teamId],
      );
      const matchup = matchupResult.rows[0];
      if (!matchup) {
        return null;
      }

      const isHome = matchup.home_team_id === teamId;
      const [categoryRows, homeActive, awayActive] = await Promise.all([
        query<{ category: string }>(`select category from league_stat_category where league_id = $1 order by side, sort_order`, [
          matchup.league_id,
        ]),
        activeLineupRows(matchup.home_team_id),
        activeLineupRows(matchup.away_team_id),
      ]);

      const liveRefs = [...homeActive, ...awayActive].filter((row) => row.mlb_player_id && row.current_mlb_team_id);
      const live = await getLiveLinesForPlayers(liveRefs);

      return buildLiveMatchupUpdate(
        isHome,
        categoryRows.rows.map((row) => row.category),
        homeActive,
        awayActive,
        live,
      );
    },
    () => notLive,
  );
}
