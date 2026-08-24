-- Yahoo-compatible points scoring needs hitting/pitching categories with the
-- same display name (BB and HBP), league-specific decimal weights, and a true
-- per-game identity so doubleheaders retain both stat lines.

alter table league_stat_category
  drop constraint league_stat_category_pkey;

alter table league_stat_category
  add primary key (league_id, side, category);

delete from league_stat_category category
using league
where category.league_id = league.id
  and league.scoring_type = 'h2h-points';

delete from matchup_category_score score
using matchup, league
where score.matchup_id = matchup.id
  and matchup.league_id = league.id
  and league.scoring_type = 'h2h-points';

insert into league_stat_category (league_id, category, side, sort_order, points_weight)
select league.id, yahoo.category, yahoo.side, yahoo.sort_order, yahoo.points_weight
from league
cross join (
  values
    ('1B',  'hitting',  0,  2.6::numeric),
    ('2B',  'hitting',  1,  5.2::numeric),
    ('3B',  'hitting',  2,  7.8::numeric),
    ('HR',  'hitting',  3, 10.4::numeric),
    ('R',   'hitting',  4,  1.9::numeric),
    ('RBI', 'hitting',  5,  1.9::numeric),
    ('BB',  'hitting',  6,  2.6::numeric),
    ('SB',  'hitting',  7,  4.2::numeric),
    ('HBP', 'hitting',  8,  2.6::numeric),
    ('SV',  'pitching', 0,  8.0::numeric),
    ('W',   'pitching', 1,  8.0::numeric),
    ('K',   'pitching', 2,  3.0::numeric),
    ('ER',  'pitching', 3, -3.0::numeric),
    ('O',   'pitching', 4,  1.0::numeric),
    ('BB',  'pitching', 5, -1.3::numeric),
    ('H',   'pitching', 6, -1.3::numeric),
    ('HBP', 'pitching', 7, -1.3::numeric)
) as yahoo(category, side, sort_order, points_weight)
where league.scoring_type = 'h2h-points';

alter table player_stat_line
  drop constraint player_stat_line_player_id_stat_date_split_source_key;

alter table player_stat_line
  add constraint player_stat_line_game_identity_key
  unique nulls not distinct (player_id, stat_date, game_pk, split, source);
