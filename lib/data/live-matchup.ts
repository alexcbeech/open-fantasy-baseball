import { query, tryDatabase } from "@/lib/db/client";
import {
  buildPointsWeightMap,
  calculateFantasyPoints,
  yahooPointsWeights,
  type PointStatSide,
  type PointsWeightMap,
} from "@/lib/fantasy/scoring";
import type { LeagueScoringType, LiveMatchupUpdate, MatchupCategoryResult } from "@/lib/fantasy/types";
import {
  compareCategory,
  computeCategoryValue,
  fantasyPointsByPlayer,
  periodLineupPlayerStats,
  totalFantasyPoints,
} from "./matchup-scoring";
import { getGameLinesForPlayersOnDate, todayEtDate, type LivePlayerRef } from "./mlb-live";

type StatMap = Record<string, number | string>;
type ActiveRow = LivePlayerRef;

const notLive: LiveMatchupUpdate = {
  live: false,
  hasTodayStats: false,
  userScore: 0,
  opponentScore: 0,
  categoryScores: [],
  livePoints: {},
};

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
async function activeLineupRows(teamId: string, officialDate: string): Promise<ActiveRow[]> {
  const result = await query<{ id: string; mlb_player_id: number | null; current_mlb_team_id: number | null }>(
    `select p.id, p.mlb_player_id, p.current_mlb_team_id
     from lineup_entry le
     join player p on p.id = le.player_id
     where le.team_id = $1
       and le.lineup_date = (
         select max(lineup_date) from lineup_entry where team_id = $1 and lineup_date <= $2
       )
       and le.slot not in ('BN', 'IL', 'NA')`,
    [teamId, officialDate],
  );
  return result.rows.map((row) => ({
    id: row.id,
    mlb_player_id: row.mlb_player_id ?? 0,
    current_mlb_team_id: row.current_mlb_team_id ?? 0,
  }));
}

function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Dates that must come from MLB boxscores rather than stored game logs. This
 * always includes the current ET date and reaches backward over any dates the
 * nightly stat import has not persisted yet.
 */
export function liveOverlayDates(input: {
  periodStartsAt: Date | string;
  periodEndsAt: Date | string;
  currentEtDate: string;
  latestStoredEtDate: string | null;
}): string[] {
  const periodStart = todayEtDate(new Date(input.periodStartsAt));
  const periodEndExclusive = todayEtDate(new Date(input.periodEndsAt));
  const lastPeriodDate = shiftIsoDate(periodEndExclusive, -1);
  const upper = input.currentEtDate < lastPeriodDate ? input.currentEtDate : lastPeriodDate;

  if (upper < periodStart) {
    return [];
  }

  const firstUnstored = input.latestStoredEtDate ? shiftIsoDate(input.latestStoredEtDate, 1) : periodStart;
  const candidateStart = firstUnstored > periodStart ? firstUnstored : periodStart;
  // Even if a manual sync wrote today's partial log, today's boxscore remains
  // authoritative and its stored line is excluded to prevent double-counting.
  const lower = candidateStart > upper ? upper : candidateStart;
  const dates: string[] = [];
  for (let date = lower; date <= upper; date = shiftIsoDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/**
 * Assemble the live matchup from both sides' completed game lines for
 * the scoring period (the same lines the stored recompute aggregates) plus
 * unsynced boxscore lines — in-progress and finished games alike, so a day's
 * production never vanishes when the final out is recorded. Each line is an
 * extra stat entry per player so counting categories sum and rate categories
 * (AVG/ERA/WHIP) stay correct — computeCategoryValue rebuilds rates from
 * summed components. Pure and side-effect free so it can be unit-tested
 * without the DB or MLB API.
 */
export function buildLiveMatchupUpdate(input: {
  scoringType: LeagueScoringType;
  isHome: boolean;
  categories: string[];
  homePeriodStats: StatMap[];
  awayPeriodStats: StatMap[];
  homeOverlayStats: StatMap[];
  awayOverlayStats: StatMap[];
  overlayPoints: Record<string, number>;
  hasOverlayStats: boolean;
  /** True while any of those games is still in progress. */
  liveGameInProgress: boolean;
  pointsWeights?: PointsWeightMap;
}): LiveMatchupUpdate {
  const {
    isHome,
    categories,
    homePeriodStats,
    awayPeriodStats,
    homeOverlayStats,
    awayOverlayStats,
    overlayPoints,
    hasOverlayStats,
    liveGameInProgress,
    pointsWeights = yahooPointsWeights,
  } = input;

  if (!hasOverlayStats) {
    return notLive;
  }

  // Combine persisted lines with date-specific boxscores that have not safely
  // completed the nightly handoff yet.
  const homeStats = homePeriodStats.concat(homeOverlayStats);
  const awayStats = awayPeriodStats.concat(awayOverlayStats);

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

  const homeScore = input.scoringType === "h2h-points" ? totalFantasyPoints(homeStats, pointsWeights) : homeWins;
  const awayScore = input.scoringType === "h2h-points" ? totalFantasyPoints(awayStats, pointsWeights) : awayWins;

  return {
    live: liveGameInProgress,
    hasTodayStats: true,
    userScore: isHome ? homeScore : awayScore,
    opponentScore: isHome ? awayScore : homeScore,
    categoryScores: input.scoringType === "h2h-points" ? [] : categoryScores,
    livePoints: overlayPoints,
  };
}

/**
 * Recompute a team's active matchup category battle from each side's scoring-
 * period game lines plus unsynced boxscore lines, on demand. Returns a no-data
 * result (so callers keep the stored nightly values) whenever no active
 * player's team has played on a date awaiting handoff.
 */
export async function computeLiveMatchup(teamId: string): Promise<LiveMatchupUpdate | null> {
  return tryDatabase(
    async () => {
      const matchupResult = await query<{
        league_id: string;
        scoring_type: LeagueScoringType;
        home_team_id: string;
        away_team_id: string;
        starts_at: Date | string;
        ends_at: Date | string;
      }>(
        `select m.league_id, l.scoring_type, m.home_team_id, m.away_team_id, sp.starts_at, sp.ends_at
         from matchup m
         join scoring_period sp on sp.id = m.scoring_period_id
         join league l on l.id = m.league_id
         where (m.home_team_id = $1 or m.away_team_id = $1) and m.status = 'active'
         limit 1`,
        [teamId],
      );
      const matchup = matchupResult.rows[0];
      if (!matchup) {
        return null;
      }

      const isHome = matchup.home_team_id === teamId;
      const currentEtDate = todayEtDate();
      const [categoryRows, pointRows, latestStored] = await Promise.all([
        matchup.scoring_type === "h2h-points"
          ? Promise.resolve({ rows: [] as { category: string }[] })
          : query<{ category: string }>(
              `select category from league_stat_category where league_id = $1 order by side, sort_order`,
              [matchup.league_id],
            ),
        matchup.scoring_type === "h2h-points"
          ? query<{
              category: string;
              side: PointStatSide;
              points_weight: string | number | null;
            }>(
              `select category, side, points_weight
               from league_stat_category
               where league_id = $1 and points_weight is not null
               order by side, sort_order`,
              [matchup.league_id],
            )
          : Promise.resolve({ rows: [] }),
        query<{ stat_date: string | null }>(
          `select max(stat_date)::text as stat_date
           from player_stat_line
           where split = 'game' and source = 'mlb-stats-api'
             and stat_date >= ($1::timestamptz at time zone 'America/New_York')::date
             and stat_date < ($2::timestamptz at time zone 'America/New_York')::date
             and collected_at <= coalesce(
               (select max(finished_at) from ingestion_run
                where job_type = 'player-stats' and status = 'succeeded'),
               '-infinity'::timestamptz
             )`,
          [matchup.starts_at, matchup.ends_at],
        ),
      ]);
      const configuredWeights = buildPointsWeightMap(pointRows.rows);
      const pointsWeights = Object.keys(configuredWeights).length ? configuredWeights : yahooPointsWeights;

      const overlayDates = liveOverlayDates({
        periodStartsAt: matchup.starts_at,
        periodEndsAt: matchup.ends_at,
        currentEtDate,
        latestStoredEtDate: latestStored.rows[0]?.stat_date ?? null,
      });
      const [homePeriodRows, awayPeriodRows, dailyOverlays] = await Promise.all([
        periodLineupPlayerStats({ query }, matchup.home_team_id, matchup.starts_at, matchup.ends_at, {
          excludeEtDates: overlayDates,
        }),
        periodLineupPlayerStats({ query }, matchup.away_team_id, matchup.starts_at, matchup.ends_at, {
          excludeEtDates: overlayDates,
        }),
        Promise.all(
          overlayDates.map(async (officialDate) => {
            const [homeActive, awayActive] = await Promise.all([
              activeLineupRows(matchup.home_team_id, officialDate),
              activeLineupRows(matchup.away_team_id, officialDate),
            ]);
            const refs = [...homeActive, ...awayActive].filter((row) => row.mlb_player_id && row.current_mlb_team_id);
            const gameLines = await getGameLinesForPlayersOnDate(refs, officialDate);
            return { homeActive, awayActive, gameLines };
          }),
        ),
      ]);

      const homePeriodStats = homePeriodRows.map((row) => row.stats);
      const awayPeriodStats = awayPeriodRows.map((row) => row.stats);
      const homeOverlayStats: StatMap[] = [];
      const awayOverlayStats: StatMap[] = [];
      const overlayPoints: Record<string, number> = {
        ...fantasyPointsByPlayer(homePeriodRows, pointsWeights),
        ...fantasyPointsByPlayer(awayPeriodRows, pointsWeights),
      };
      let hasOverlayStats = false;
      let liveGameInProgress = false;

      for (const overlay of dailyOverlays) {
        const { lines } = overlay.gameLines;
        if (Object.keys(lines).length) {
          hasOverlayStats = true;
        }
        liveGameInProgress ||= overlay.gameLines.liveGameInProgress;

        for (const row of overlay.homeActive) {
          const entry = lines[row.id];
          if (entry) {
            homeOverlayStats.push(entry.stats);
            overlayPoints[row.id] =
              Math.round(((overlayPoints[row.id] ?? 0) + calculateFantasyPoints(entry.stats, pointsWeights)) * 10) / 10;
          }
        }
        for (const row of overlay.awayActive) {
          const entry = lines[row.id];
          if (entry) {
            awayOverlayStats.push(entry.stats);
            overlayPoints[row.id] =
              Math.round(((overlayPoints[row.id] ?? 0) + calculateFantasyPoints(entry.stats, pointsWeights)) * 10) / 10;
          }
        }
      }

      return buildLiveMatchupUpdate({
        scoringType: matchup.scoring_type,
        isHome,
        categories: categoryRows.rows.map((row) => row.category),
        homePeriodStats,
        awayPeriodStats,
        homeOverlayStats,
        awayOverlayStats,
        overlayPoints,
        hasOverlayStats,
        liveGameInProgress,
        pointsWeights,
      });
    },
    () => notLive,
  );
}
