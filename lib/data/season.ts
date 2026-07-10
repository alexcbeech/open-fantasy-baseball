import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db/client";
import { buildSeasonSchedule, roundRobinPairs, type SeasonPeriodPlan } from "@/lib/fantasy/season-schedule";

type Queryable = Pick<Pool | PoolClient, "query">;

type PeriodRow = {
  id: string;
  label: string;
  starts_at: Date;
  ends_at: Date;
  status: "scheduled" | "active" | "final";
  is_playoff: boolean;
};

/**
 * Make sure an active league has a real season: weekly scoring periods with
 * round-robin matchups from now to season end plus playoff rounds. Idempotent
 * and cheap when the schedule already exists; also backfills matchups for any
 * non-final period that lacks them (e.g. the old single "Draft Week") and
 * activates whichever period covers `now`. Safe to call lazily on reads.
 */
export async function ensureSeasonSchedule(db: Queryable, leagueId: string, now = new Date()): Promise<void> {
  const league = await db.query<{ status: string; season_year: number | null; playoff_team_count: number | null }>(
    `select status, season_year, (settings->>'playoffTeamCount')::int as playoff_team_count
     from league where id = $1`,
    [leagueId],
  );
  const row = league.rows[0];

  if (!row || (row.status !== "active" && row.status !== "playoffs")) {
    return;
  }

  const teams = await db.query<{ id: string }>(
    `select id from fantasy_team where league_id = $1 order by created_at, id`,
    [leagueId],
  );
  const teamIds = teams.rows.map((team) => team.id);

  if (teamIds.length < 2) {
    return;
  }

  const periods = await db.query<PeriodRow>(
    `select id, label, starts_at, ends_at, status, is_playoff
     from scoring_period where league_id = $1 order by starts_at`,
    [leagueId],
  );

  const last = periods.rows.at(-1) ?? null;
  const hasScheduledFuture = periods.rows.some((period) => period.status === "scheduled" && period.ends_at > now);
  // Once the schedule reaches its playoff rounds, the season is fully built;
  // never append more weeks after it (the last round ending ends the season).
  const seasonFullyBuilt = periods.rows.some((period) => period.is_playoff);

  if (!hasScheduledFuture && !seasonFullyBuilt) {
    // Generate the remaining season: from the end of the last period when it
    // reaches past now (a schedule extension), otherwise from now.
    const from = last && last.ends_at > now ? last.ends_at : now;
    const plan = buildSeasonSchedule({
      teamIds,
      seasonYear: row.season_year ?? now.getUTCFullYear(),
      playoffTeamCount: row.playoff_team_count ?? 0,
      from,
      startWeekNumber: periods.rows.length + 1,
      rotationOffset: periods.rows.length,
    });
    await insertPeriods(db, leagueId, plan);
  }

  await backfillMissingMatchups(db, leagueId, teamIds);
  await activateDuePeriods(db, leagueId, now);
}

async function insertPeriods(db: Queryable, leagueId: string, plan: SeasonPeriodPlan[]): Promise<void> {
  for (const period of plan) {
    const inserted = await db.query<{ id: string }>(
      `insert into scoring_period (league_id, label, starts_at, ends_at, status, is_playoff, playoff_round)
       values ($1, $2, $3, $4, 'scheduled', $5, $6)
       on conflict (league_id, label) do nothing
       returning id`,
      [leagueId, period.label, period.startsAt, period.endsAt, period.isPlayoff, period.playoffRound],
    );
    const periodId = inserted.rows[0]?.id;

    if (!periodId) {
      continue;
    }

    for (const pairing of period.matchups) {
      await db.query(
        `insert into matchup (league_id, scoring_period_id, home_team_id, away_team_id, status)
         values ($1, $2, $3, $4, 'scheduled')
         on conflict (scoring_period_id, home_team_id, away_team_id) do nothing`,
        [leagueId, periodId, pairing.homeTeamId, pairing.awayTeamId],
      );
    }
  }
}

/** Give every non-final regular period a round-robin slate if it has none. */
async function backfillMissingMatchups(db: Queryable, leagueId: string, teamIds: string[]): Promise<void> {
  const missing = await db.query<{ id: string; status: string; week_index: number | string }>(
    `select sp.id, sp.status,
       (row_number() over (order by sp.starts_at)) - 1 as week_index
     from scoring_period sp
     where sp.league_id = $1 and sp.is_playoff = false
       and sp.status <> 'final'
       and not exists (select 1 from matchup m where m.scoring_period_id = sp.id)`,
    [leagueId],
  );

  for (const period of missing.rows) {
    const pairings = roundRobinPairs(teamIds, Number(period.week_index));

    for (const pairing of pairings) {
      await db.query(
        `insert into matchup (league_id, scoring_period_id, home_team_id, away_team_id, status)
         values ($1, $2, $3, $4, $5)
         on conflict (scoring_period_id, home_team_id, away_team_id) do nothing`,
        [leagueId, period.id, pairing.homeTeamId, pairing.awayTeamId, period.status === "active" ? "active" : "scheduled"],
      );
    }
  }
}

/**
 * Flip the scheduled period covering `now` (and its matchups) to active.
 * No-ops while another period is still active — finalization ends it first.
 */
export async function activateDuePeriods(db: Queryable, leagueId: string, now = new Date()): Promise<void> {
  const active = await db.query<{ id: string }>(
    `select id from scoring_period where league_id = $1 and status = 'active' limit 1`,
    [leagueId],
  );

  if (active.rows.length) {
    return;
  }

  const due = await db.query<{ id: string }>(
    `update scoring_period
     set status = 'active'
     where id = (
       select id from scoring_period
       where league_id = $1 and status = 'scheduled' and starts_at <= $2 and ends_at > $2
       order by starts_at
       limit 1
     )
     returning id`,
    [leagueId, now],
  );
  const periodId = due.rows[0]?.id;

  if (periodId) {
    await db.query(`update matchup set status = 'active' where scoring_period_id = $1 and status = 'scheduled'`, [periodId]);
  }
}

export type TeamRecordRow = {
  team_id: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
};

/**
 * W-L-T and accumulated points per team from finalized matchups. Points are
 * the sum of the team's matchup scores (category wins or fantasy points,
 * depending on the league's scoring), which doubles as the standings
 * tiebreaker.
 */
export const teamRecordsSql = `
  select team_id,
    count(*) filter (where my_score > their_score) as wins,
    count(*) filter (where my_score < their_score) as losses,
    count(*) filter (where my_score = their_score) as ties,
    coalesce(sum(my_score), 0) as points
  from (
    select m.home_team_id as team_id, m.home_score as my_score, m.away_score as their_score
    from matchup m where m.league_id = $1 and m.status = 'final'
    union all
    select m.away_team_id, m.away_score, m.home_score
    from matchup m where m.league_id = $1 and m.status = 'final'
  ) sides
  group by team_id
`;

export async function teamRecordsForLeague(leagueId: string): Promise<Map<string, TeamRecordRow>> {
  const result = await getPool().query<TeamRecordRow>(teamRecordsSql, [leagueId]);
  return new Map(
    result.rows.map((row) => [
      row.team_id,
      {
        team_id: row.team_id,
        wins: Number(row.wins),
        losses: Number(row.losses),
        ties: Number(row.ties),
        points: Number(row.points),
      },
    ]),
  );
}
