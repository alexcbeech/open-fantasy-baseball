import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export type LineupSnapshot = {
  lineupDate: string;
  scoringPeriodId: string;
};

/**
 * Materialize the lineup effective today (MLB's ET official date) before it is
 * mutated. Previous dates stay immutable, while repeated mutations today keep
 * editing the same complete snapshot.
 */
export async function ensureTodayLineupSnapshot(
  db: Queryable,
  teamId: string,
  leagueId: string,
): Promise<LineupSnapshot | null> {
  const context = await db.query<{ lineup_date: string; scoring_period_id: string | null }>(
    `select
       (now() at time zone 'America/New_York')::date::text as lineup_date,
       (select id
        from scoring_period
        where league_id = $1 and status = 'active'
        order by starts_at desc
        limit 1) as scoring_period_id`,
    [leagueId],
  );
  const lineupDate = context.rows[0]?.lineup_date;
  const scoringPeriodId = context.rows[0]?.scoring_period_id;

  if (!lineupDate || !scoringPeriodId) {
    return null;
  }

  await db.query(
    `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
     select le.team_id, le.player_id, $2, $3::date, le.slot
     from lineup_entry le
     where le.team_id = $1
       and le.lineup_date = (
         select max(lineup_date)
         from lineup_entry
         where team_id = $1 and lineup_date <= $3::date
       )
     on conflict (team_id, player_id, lineup_date) do nothing`,
    [teamId, scoringPeriodId, lineupDate],
  );

  return { lineupDate, scoringPeriodId };
}
