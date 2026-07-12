import type { Pool, PoolClient } from "pg";

// SQL-side game-start locks. The lineup editor enforces locks with
// isPlayerGameLocked/findLineupLockIssues over LineupPlayer objects; the
// player-action and detail paths never materialize those, so these helpers
// answer the same questions ("has this player's game today started?") directly
// in SQL, using the same ET-official-date definition of "today" as the
// todays_game lateral in lib/data/teams.ts.

type Queryable = Pick<Pool | PoolClient, "query">;

/**
 * EXISTS fragment: the referenced player has an MLB game today (ET official
 * date) whose first pitch has passed. `playerRef` must be a code constant
 * (a bind placeholder or column reference), never user input.
 */
export function startedGameTodaySql(playerRef: string): string {
  return `exists (
    select 1
    from mlb_game g
    join player lp on lp.id = ${playerRef}
    where (g.home_mlb_team_id = lp.current_mlb_team_id or g.away_mlb_team_id = lp.current_mlb_team_id)
      and coalesce(g.official_date, (g.game_date at time zone 'America/New_York')::date)
          = (now() at time zone 'America/New_York')::date
      and g.game_date <= now()
  )`;
}

/** Whether the player's MLB game today has already started. */
export async function hasStartedGameToday(db: Queryable, playerId: string): Promise<boolean> {
  const result = await db.query<{ started: boolean }>(
    `select ${startedGameTodaySql("$1::uuid")} as started`,
    [playerId],
  );
  return result.rows[0]?.started ?? false;
}

/**
 * Whether any player in the team's current lineup has a started game today —
 * the whole-lineup lock condition for first-game leagues (the SQL mirror of
 * isLineupFirstGameLocked).
 */
export async function lineupHasStartedGameToday(db: Queryable, teamId: string): Promise<boolean> {
  const result = await db.query<{ locked: boolean }>(
    `select exists (
       select 1
       from lineup_entry le
       where le.team_id = $1
         and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
         and ${startedGameTodaySql("le.player_id")}
     ) as locked`,
    [teamId],
  );
  return result.rows[0]?.locked ?? false;
}

/**
 * Whether the league has an active scoring period. Game-start locks only
 * protect a live lineup: with no active period there is no lineup row for
 * today's stats, so off-season/pre-season moves stay unrestricted.
 */
export async function hasActiveScoringPeriod(db: Queryable, leagueId: string): Promise<boolean> {
  const result = await db.query<{ active: boolean }>(
    `select exists (select 1 from scoring_period where league_id = $1 and status = 'active') as active`,
    [leagueId],
  );
  return result.rows[0]?.active ?? false;
}
