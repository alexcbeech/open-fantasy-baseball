import type { PoolClient } from "pg";

const MINIMUM_GAMES_FOR_OFFSEASON_EXPIRATION = 20;

/** Eligibility can only be removed during OFB's November-February offseason. */
export function isPositionEligibilityOffseason(today: Date) {
  const month = today.getUTCMonth();
  return month >= 10 || month <= 1;
}

export type OffseasonEligibilityResult = {
  upcomingSeason: number;
  expired: number;
  effectiveThrough: string;
};

/**
 * Close genuinely stale hitter eligibility between seasons. Fielding-earned
 * and roster-seeded positions get a two-season qualification window, are
 * protected when MLB still lists them as the player's current position, and
 * are also protected after an injury/low-volume year (fewer than 20 MLB
 * games). Legacy and manually granted positions are deliberately untouched.
 */
export async function reconcileOffseasonPositionEligibility(
  client: Pick<PoolClient, "query">,
  upcomingSeason: number,
  today = new Date(),
): Promise<OffseasonEligibilityResult> {
  if (!Number.isInteger(upcomingSeason) || upcomingSeason < 1900 || upcomingSeason > 3000) {
    throw new Error("Upcoming season must be a four-digit year.");
  }
  if (!isPositionEligibilityOffseason(today)) {
    throw new Error("Position eligibility can only be expired from November through February.");
  }

  const effectiveThrough = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
  const oldestRetainedSeason = upcomingSeason - 2;
  const mostRecentCompletedSeason = upcomingSeason - 1;

  const result = await client.query(
    `update player_position_eligibility eligibility
     set valid_to = $1::date
     where eligibility.valid_to is null
       and (
         eligibility.last_roster_confirmed_at is null
         or eligibility.last_roster_confirmed_at < $1::date - interval '90 days'
       )
       and (
         (
           eligibility.qualification_method = 'fielding'
           and eligibility.last_qualified_season < $2
         )
         or (
           eligibility.qualification_method = 'roster'
           and not exists (
             select 1
             from player_position_observation observation
             where observation.player_id = eligibility.player_id
               and observation.position = eligibility.position
               and observation.season_year >= $2
               and (
                 observation.games_started >= 5
                 or observation.appearances >= 10
               )
           )
         )
       )
       and exists (
         select 1
         from player_season_appearance season
         where season.player_id = eligibility.player_id
           and season.season_year = $3
           and season.source = 'mlb-stats-api'
           and season.games_played >= $4
       )`,
    [effectiveThrough, oldestRetainedSeason, mostRecentCompletedSeason, MINIMUM_GAMES_FOR_OFFSEASON_EXPIRATION],
  );

  return {
    upcomingSeason,
    expired: result.rowCount ?? 0,
    effectiveThrough,
  };
}
