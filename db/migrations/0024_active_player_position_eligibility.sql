with ranked as (
  select
    player_id,
    position,
    valid_from,
    max(valid_from) over (partition by player_id, position) as latest_valid_from,
    row_number() over (partition by player_id, position order by valid_from desc) as recency
  from player_position_eligibility
  where valid_to is null
)
update player_position_eligibility eligibility
set valid_to = ranked.latest_valid_from - 1
from ranked
where eligibility.player_id = ranked.player_id
  and eligibility.position = ranked.position
  and eligibility.valid_from = ranked.valid_from
  and ranked.recency > 1;

create unique index if not exists idx_player_position_eligibility_active
  on player_position_eligibility (player_id, position)
  where valid_to is null;
