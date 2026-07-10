import { getPool } from "../db/client";
import { calculateFantasyPoints, inningsFromIpNotation } from "@/lib/fantasy/scoring";
import { ensureSeasonSchedule } from "./season";

type StatMap = Record<string, number | string>;

// Rate categories where a lower number wins the category.
const lowerIsBetter = new Set(["ERA", "WHIP"]);

function num(value: number | string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A team's total for a scoring category across its active players. Counting
 * stats sum; rate stats are recomputed from their components so a team AVG is
 * total hits / total at-bats rather than an average of averages. IP lines use
 * baseball notation (6.2 = 6⅔), so innings are converted before summing.
 * Returns null when a rate category has no denominator (no at-bats/innings):
 * there is no value to compare, which scores as a tie rather than a perfect 0.
 */
export function computeCategoryValue(category: string, stats: StatMap[]): number | null {
  const sum = (key: string) => stats.reduce((total, line) => total + num(line[key]), 0);
  const sumInnings = () => stats.reduce((total, line) => total + inningsFromIpNotation(line.IP), 0);

  if (category === "AVG") {
    const atBats = sum("AB");
    return atBats ? sum("H") / atBats : null;
  }
  if (category === "ERA") {
    const innings = sumInnings();
    return innings ? (sum("ER") * 9) / innings : null;
  }
  if (category === "WHIP") {
    const innings = sumInnings();
    return innings ? (sum("BB") + sum("HA")) / innings : null;
  }
  if (category === "IP") {
    return sumInnings();
  }
  return sum(category);
}

export function compareCategory(
  category: string,
  homeValue: number | null,
  awayValue: number | null,
): "win" | "loss" | "tie" {
  // A side with no rate denominator has no value; the category is a
  // no-contest tie rather than an automatic 0.00 ERA/WHIP win.
  if (homeValue === null || awayValue === null || homeValue === awayValue) {
    return "tie";
  }
  const homeBetter = lowerIsBetter.has(category) ? homeValue < awayValue : homeValue > awayValue;
  return homeBetter ? "win" : "loss";
}

export async function activeLineupStats(client: { query: <T>(sql: string, values: unknown[]) => Promise<{ rows: T[] }> }, teamId: string) {
  const result = await client.query<{ stats: StatMap }>(
    `select season_stats.stats
     from lineup_entry le
     join lateral (
       select stats from player_stat_line psl
       where psl.player_id = le.player_id and psl.split = 'season'
       order by stat_date desc limit 1
     ) season_stats on true
     where le.team_id = $1
       and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
       and le.slot not in ('BN', 'IL', 'NA')`,
    [teamId],
  );
  return result.rows.map((row) => row.stats);
}

export type RecomputeMatchupsResult = {
  matchups: number;
  categoriesWritten: number;
};

/** Team fantasy-point total across its active lineup, to one decimal. */
function totalFantasyPoints(statLines: StatMap[]): number {
  const total = statLines.reduce((sum, line) => sum + calculateFantasyPoints(line), 0);
  return Math.round(total * 10) / 10;
}

/**
 * Recompute each active matchup's category battle from the current active
 * lineups' real season stats, updating matchup_category_score and the
 * categories-won score on the matchup itself.
 */
export async function recomputeMatchups(leagueId?: string): Promise<RecomputeMatchupsResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const matchups = await client.query<{
      id: string;
      league_id: string;
      home_team_id: string;
      away_team_id: string;
      scoring_type: string | null;
    }>(
      `select m.id, m.league_id, m.home_team_id, m.away_team_id, l.scoring_type
       from matchup m
       join league l on l.id = m.league_id
       where m.status = 'active' ${leagueId ? "and m.league_id = $1" : ""}`,
      leagueId ? [leagueId] : [],
    );

    let categoriesWritten = 0;

    for (const matchup of matchups.rows) {
      const categoryRows = await client.query<{ category: string }>(
        `select category from league_stat_category where league_id = $1 order by side, sort_order`,
        [matchup.league_id],
      );
      const categories = categoryRows.rows.map((row) => row.category);
      const homeStats = await activeLineupStats(client, matchup.home_team_id);
      const awayStats = await activeLineupStats(client, matchup.away_team_id);

      let homeWins = 0;
      let awayWins = 0;

      for (const category of categories) {
        const homeValue = computeCategoryValue(category, homeStats);
        const awayValue = computeCategoryValue(category, awayStats);
        const result = compareCategory(category, homeValue, awayValue);

        if (result === "win") {
          homeWins += 1;
        } else if (result === "loss") {
          awayWins += 1;
        }

        await client.query(
          `insert into matchup_category_score (matchup_id, category, home_value, away_value, home_result)
           values ($1, $2, $3, $4, $5)
           on conflict (matchup_id, category) do update set
             home_value = excluded.home_value,
             away_value = excluded.away_value,
             home_result = excluded.home_result`,
          [
            matchup.id,
            category,
            Math.round((homeValue ?? 0) * 10000) / 10000,
            Math.round((awayValue ?? 0) * 10000) / 10000,
            result,
          ],
        );
        categoriesWritten += 1;
      }

      // Category battles still get written for every league (they're shown in
      // the matchup detail), but the matchup SCORE depends on the league type:
      // h2h-points compares total fantasy points; categories compares wins.
      const [homeScore, awayScore] =
        matchup.scoring_type === "h2h-points"
          ? [totalFantasyPoints(homeStats), totalFantasyPoints(awayStats)]
          : [homeWins, awayWins];

      await client.query(`update matchup set home_score = $1, away_score = $2 where id = $3`, [homeScore, awayScore, matchup.id]);
    }

    return { matchups: matchups.rows.length, categoriesWritten };
  } finally {
    client.release();
  }
}

export type FinalizeMatchupsResult = {
  periodsFinalized: number;
  matchupsFinalized: number;
};

/**
 * Lock scoring periods whose window has closed: recompute their matchups one
 * last time so the snapshot reflects final stats, then flip the matchups and
 * the period to 'final' so live recomputes stop touching them. Idempotent --
 * once a period is 'final' it is no longer selected.
 */
export async function finalizeEndedMatchups(now = new Date()): Promise<FinalizeMatchupsResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const periods = await client.query<{ id: string; league_id: string }>(
      `select id, league_id from scoring_period where status = 'active' and ends_at < $1`,
      [now],
    );

    let matchupsFinalized = 0;

    for (const period of periods.rows) {
      // Freshen the category battle before snapshotting, independent of whether
      // the recompute_matchups job already ran this drain.
      await recomputeMatchups(period.league_id);

      const locked = await client.query(
        `update matchup set status = 'final' where scoring_period_id = $1 and status = 'active'`,
        [period.id],
      );
      matchupsFinalized += locked.rowCount ?? 0;

      await client.query(`update scoring_period set status = 'final' where id = $1`, [period.id]);

      // A closed week opens the next one: activate the period covering now
      // (and extend the schedule if the season ran out of generated weeks).
      await ensureSeasonSchedule(client, period.league_id, now);
    }

    return { periodsFinalized: periods.rows.length, matchupsFinalized };
  } finally {
    client.release();
  }
}
