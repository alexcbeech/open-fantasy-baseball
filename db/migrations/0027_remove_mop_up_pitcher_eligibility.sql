-- A position player who pitches once in a blowout receives a real MLB
-- pitching stat block. The old small-sample fallback interpreted that as RP
-- eligibility. Close those pitching-derived rows while preserving:
--   * MLB-rostered pitchers (active P eligibility), and
--   * starters named as a probable pitcher in the imported schedule.
--
-- Matchup scores, lineup history, and player stat lines are intentionally
-- untouched; this migration only repairs current roster eligibility.

with latest_pitching_usage as (
  select distinct on (stat.player_id)
    stat.player_id,
    greatest(coalesce((stat.stats->>'GS')::numeric, 0), 0)::integer as starts,
    greatest(
      coalesce((stat.stats->>'G')::numeric, 0),
      coalesce((stat.stats->>'GS')::numeric, 0),
      0
    )::integer as games
  from player_stat_line stat
  where stat.split = 'season'
    and stat.source = 'mlb-stats-api'
    and stat.stats ? 'GS'
  order by stat.player_id, stat.stat_date desc, stat.collected_at desc
)
update player_position_eligibility eligibility
set valid_to = current_date
from latest_pitching_usage usage
where eligibility.player_id = usage.player_id
  and eligibility.valid_to is null
  and eligibility.qualification_method = 'pitching'
  and (
    (
      eligibility.position = 'SP'
      and usage.starts < 3
      and not exists (
        select 1
        from mlb_game game
        where game.home_probable_pitcher_player_id = eligibility.player_id
           or game.away_probable_pitcher_player_id = eligibility.player_id
      )
    )
    or
    (
      eligibility.position = 'RP'
      and usage.games - usage.starts < 3
      and not exists (
        select 1
        from player_position_eligibility roster_role
        where roster_role.player_id = eligibility.player_id
          and roster_role.position = 'P'
          and roster_role.valid_to is null
      )
    )
  );
