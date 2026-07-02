import pg from "pg";
import { getDatabasePoolConfig } from "./db-config.mjs";

const { Pool } = pg;
const pool = new Pool(getDatabasePoolConfig());

const leagueId = "00000000-0000-4000-8000-000000000101";
const periodId = "00000000-0000-4000-8000-000000000201";
const teams = [
  ["00000000-0000-4000-8000-000000000301", "Golden Sombreros", "GS", 3],
  ["00000000-0000-4000-8000-000000000302", "Warning Track Power", "WTP", 4],
  ["00000000-0000-4000-8000-000000000303", "Launch Angle Lab", "LAL", 1],
];
const players = [
  ["00000000-0000-4000-8000-000000000401", 677594, "Julio Rodriguez", 136, "SEA", ["OF"], "active"],
  ["00000000-0000-4000-8000-000000000402", 682998, "Corbin Carroll", 109, "ARI", ["OF"], "day-to-day"],
  ["00000000-0000-4000-8000-000000000403", 675911, "Spencer Strider", 144, "ATL", ["SP", "P"], "injured"],
  ["00000000-0000-4000-8000-000000000404", 662253, "Andres Munoz", 136, "SEA", ["RP", "P"], "active"],
  ["00000000-0000-4000-8000-000000000405", 682829, "Elly De La Cruz", 113, "CIN", ["SS", "3B"], "active"],
  ["00000000-0000-4000-8000-000000000406", 668939, "Adley Rutschman", 110, "BAL", ["C"], "active"],
  ["00000000-0000-4000-8000-000000000407", 518692, "Freddie Freeman", 119, "LAD", ["1B"], "active"],
  ["00000000-0000-4000-8000-000000000408", 669373, "Tarik Skubal", 116, "DET", ["SP", "P"], "active"],
];
const lineup = [
  ["C", players[5][0], 7.5],
  ["1B", players[6][0], 12.0],
  ["OF", players[0][0], 18.4],
  ["SS", players[4][0], 15.3],
  ["SP", players[7][0], 22.6],
  ["RP", players[3][0], 9.2],
  ["BN", players[1][0], 4.1],
  ["IL", players[2][0], 0],
];
const playerStats = {
  [players[0][0]]: {
    season: { R: 58, HR: 17, RBI: 54, SB: 19, AVG: 0.283 },
    last_7: { R: 6, HR: 2, RBI: 7, SB: 2, AVG: 0.321 },
    last_14: { R: 11, HR: 4, RBI: 13, SB: 4, AVG: 0.306 },
    last_30: { R: 24, HR: 7, RBI: 25, SB: 8, AVG: 0.294 },
    projection_ros: { R: 49, HR: 15, RBI: 48, SB: 15, AVG: 0.278 },
  },
  [players[1][0]]: {
    season: { R: 52, HR: 14, RBI: 45, SB: 22, AVG: 0.271 },
    last_7: { R: 3, HR: 1, RBI: 4, SB: 3, AVG: 0.244 },
    last_14: { R: 9, HR: 3, RBI: 10, SB: 6, AVG: 0.263 },
    last_30: { R: 21, HR: 6, RBI: 20, SB: 11, AVG: 0.276 },
    projection_ros: { R: 47, HR: 14, RBI: 43, SB: 20, AVG: 0.272 },
  },
  [players[2][0]]: {
    season: { W: 3, SV: 0, K: 65, ERA: 3.41, WHIP: 1.13 },
    last_7: { W: 0, SV: 0, K: 0, ERA: 0, WHIP: 0 },
    last_14: { W: 0, SV: 0, K: 0, ERA: 0, WHIP: 0 },
    last_30: { W: 0, SV: 0, K: 0, ERA: 0, WHIP: 0 },
    projection_ros: { W: 4, SV: 0, K: 89, ERA: 3.33, WHIP: 1.09 },
  },
  [players[3][0]]: {
    season: { W: 2, SV: 18, K: 49, ERA: 2.12, WHIP: 0.92 },
    last_7: { W: 0, SV: 2, K: 6, ERA: 0, WHIP: 0.67 },
    last_14: { W: 1, SV: 4, K: 12, ERA: 1.29, WHIP: 0.71 },
    last_30: { W: 1, SV: 8, K: 22, ERA: 1.86, WHIP: 0.84 },
    projection_ros: { W: 2, SV: 16, K: 45, ERA: 2.49, WHIP: 0.98 },
  },
  [players[4][0]]: {
    season: { R: 61, HR: 15, RBI: 49, SB: 34, AVG: 0.266 },
    last_7: { R: 7, HR: 1, RBI: 6, SB: 4, AVG: 0.292 },
    last_14: { R: 14, HR: 4, RBI: 13, SB: 8, AVG: 0.285 },
    last_30: { R: 27, HR: 7, RBI: 24, SB: 14, AVG: 0.273 },
    projection_ros: { R: 55, HR: 14, RBI: 47, SB: 27, AVG: 0.258 },
  },
  [players[5][0]]: {
    season: { R: 41, HR: 12, RBI: 43, SB: 1, AVG: 0.279 },
    last_7: { R: 4, HR: 2, RBI: 5, SB: 0, AVG: 0.333 },
    last_14: { R: 8, HR: 3, RBI: 10, SB: 0, AVG: 0.298 },
    last_30: { R: 17, HR: 5, RBI: 21, SB: 1, AVG: 0.286 },
    projection_ros: { R: 35, HR: 11, RBI: 39, SB: 1, AVG: 0.274 },
  },
  [players[6][0]]: {
    season: { R: 55, HR: 13, RBI: 59, SB: 4, AVG: 0.315 },
    last_7: { R: 5, HR: 1, RBI: 8, SB: 0, AVG: 0.355 },
    last_14: { R: 11, HR: 3, RBI: 15, SB: 1, AVG: 0.337 },
    last_30: { R: 23, HR: 6, RBI: 28, SB: 2, AVG: 0.323 },
    projection_ros: { R: 45, HR: 12, RBI: 49, SB: 3, AVG: 0.303 },
  },
  [players[7][0]]: {
    season: { W: 9, SV: 0, K: 121, ERA: 2.58, WHIP: 0.94 },
    last_7: { W: 1, SV: 0, K: 12, ERA: 1.5, WHIP: 0.83 },
    last_14: { W: 2, SV: 0, K: 23, ERA: 2.12, WHIP: 0.88 },
    last_30: { W: 4, SV: 0, K: 47, ERA: 2.37, WHIP: 0.91 },
    projection_ros: { W: 7, SV: 0, K: 102, ERA: 2.87, WHIP: 1.01 },
  },
};
const playerNews = {
  [players[0][0]]: [
    "Rodriguez has reached base in eight straight games and remains locked into the top third of Seattle's order.",
    "A strong stolen-base pace keeps Rodriguez among the safest five-category outfield anchors.",
  ],
  [players[1][0]]: [
    "Carroll is day-to-day after a minor hand issue but is expected to avoid the injured list.",
    "Arizona plans to reevaluate Carroll after batting practice before setting the next lineup.",
  ],
  [players[2][0]]: [
    "Strider continues his throwing progression and remains stashed in IL formats.",
    "Atlanta has not announced a firm return date, but the strikeout upside is still worth monitoring.",
  ],
  [players[3][0]]: [
    "Munoz converted back-to-back save chances and has tightened his hold on ninth-inning work.",
    "His whiff rate continues to drive elite relief ratios.",
  ],
  [players[4][0]]: [
    "De La Cruz added another steal Tuesday and remains one of the league's premier speed sources.",
    "The Reds continue to give him everyday shortstop reps near the top of the lineup.",
  ],
  [players[5][0]]: [
    "Rutschman homered twice over the weekend and is trending up in run-producing spots.",
    "Baltimore continues to rotate him between catcher and DH to preserve his bat.",
  ],
  [players[6][0]]: [
    "Freeman extended his hitting streak and continues to stabilize batting average builds.",
    "The Dodgers first baseman remains an everyday fixture against right- and left-handed pitching.",
  ],
  [players[7][0]]: [
    "Skubal struck out double-digit batters again and continues to anchor fantasy rotations.",
    "Detroit has kept him on a normal workload after his latest dominant start.",
  ],
};
const rosterSlots = {
  C: 1,
  "1B": 1,
  "2B": 1,
  "3B": 1,
  SS: 1,
  OF: 3,
  UTIL: 2,
  SP: 2,
  RP: 2,
  P: 4,
  BN: 5,
  IL: 4,
  NA: 0,
};
const leagueSettings = {
  id: leagueId,
  name: "Sunday Night Rotisserie",
  scoringType: "h2h-categories",
  teamCount: 12,
  maxTeams: 20,
  hitterCategories: ["R", "HR", "RBI", "SB", "AVG"],
  pitcherCategories: ["W", "SV", "K", "ERA", "WHIP"],
  rosterSlots,
  inningsMinimumPerMatchup: 7,
  waiverMode: "rolling",
  faabBudget: 100,
  tradeReview: "league-vote",
  tradeReviewDays: 2,
  playoffTeamCount: 6,
  lineupLockMode: "daily",
  draftType: "snake",
  allowILPlus: false,
  allowNA: false,
  addDropDeadlineDays: [0, 1, 2, 3, 4, 5, 6],
  waiverProcessingDays: [0, 1, 2, 3, 4, 5, 6],
};

async function main() {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const userResult = await client.query(
      `insert into app_user (email, display_name)
       values ('alex@example.local', 'Alex')
       on conflict (email) do update set display_name = excluded.display_name
       returning id`,
    );
    const userId = userResult.rows[0].id;
    await client.query(
      `insert into user_preference (user_id, time_zone, notification_settings)
       values ($1, 'America/Los_Angeles', '{"injuries": true, "trades": true, "waivers": true, "lineupAlerts": false, "displayMode": "auto"}'::jsonb)
       on conflict (user_id) do update set
         time_zone = excluded.time_zone,
         notification_settings = user_preference.notification_settings || excluded.notification_settings`,
      [userId],
    );
    await client.query(
      `insert into league (id, name, scoring_type, season_year, commissioner_user_id, status, settings)
       values ($1, 'Sunday Night Rotisserie', 'h2h-categories', 2026, $2, 'active', $3)
       on conflict (id) do update set settings = excluded.settings, updated_at = now()`,
      [leagueId, userId, JSON.stringify(leagueSettings)],
    );
    await client.query(
      `insert into league_member (league_id, user_id, role)
       values ($1, $2, 'commissioner')
       on conflict (league_id, user_id) do update set role = excluded.role`,
      [leagueId, userId],
    );

    for (const [slot, count] of Object.entries(rosterSlots)) {
      await client.query(
        `insert into league_roster_slot (league_id, slot, count)
         values ($1, $2, $3)
         on conflict (league_id, slot) do update set count = excluded.count`,
        [leagueId, slot, count],
      );
    }

    for (const [index, category] of ["R", "HR", "RBI", "SB", "AVG"].entries()) {
      await client.query(
        `insert into league_stat_category (league_id, category, side, sort_order)
         values ($1, $2, 'hitting', $3)
         on conflict (league_id, category) do update set side = excluded.side, sort_order = excluded.sort_order`,
        [leagueId, category, index],
      );
    }

    for (const [index, category] of ["W", "SV", "K", "ERA", "WHIP"].entries()) {
      await client.query(
        `insert into league_stat_category (league_id, category, side, sort_order)
         values ($1, $2, 'pitching', $3)
         on conflict (league_id, category) do update set side = excluded.side, sort_order = excluded.sort_order`,
        [leagueId, category, index],
      );
    }

    for (const [id, name, abbreviation, waiverPriority] of teams) {
      await client.query(
        `insert into fantasy_team (id, league_id, manager_user_id, name, abbreviation, waiver_priority, faab_remaining)
         values ($1, $2, $3, $4, $5, $6, 100)
         on conflict (id) do update set name = excluded.name, abbreviation = excluded.abbreviation, waiver_priority = excluded.waiver_priority`,
        [id, leagueId, userId, name, abbreviation, waiverPriority],
      );
    }

    await client.query(
      `insert into scoring_period (id, league_id, label, starts_at, ends_at, status)
       values ($1, $2, 'Week 13', '2026-06-29T04:00:00Z', '2026-07-06T03:59:59Z', 'active')
       on conflict (league_id, label) do update set status = excluded.status`,
      [periodId, leagueId],
    );
    const matchupResult = await client.query(
      `insert into matchup (league_id, scoring_period_id, home_team_id, away_team_id, home_score, away_score, status)
       values ($1, $2, $3, $4, 6, 4, 'active')
       on conflict (scoring_period_id, home_team_id, away_team_id)
       do update set home_score = excluded.home_score, away_score = excluded.away_score, status = excluded.status
       returning id`,
      [leagueId, periodId, teams[0][0], teams[1][0]],
    );
    const matchupId = matchupResult.rows[0].id;
    const categoryScores = [
      ["R", 27, 24, "win"],
      ["HR", 8, 8, "tie"],
      ["RBI", 25, 29, "loss"],
      ["SB", 7, 3, "win"],
      ["AVG", 0.281, 0.267, "win"],
      ["W", 3, 2, "win"],
      ["SV", 2, 4, "loss"],
      ["K", 61, 56, "win"],
      ["ERA", 3.12, 3.42, "win"],
      ["WHIP", 1.08, 1.13, "win"],
    ];

    for (const [category, homeValue, awayValue, homeResult] of categoryScores) {
      await client.query(
        `insert into matchup_category_score (matchup_id, category, home_value, away_value, home_result)
         values ($1, $2, $3, $4, $5)
         on conflict (matchup_id, category)
         do update set home_value = excluded.home_value, away_value = excluded.away_value, home_result = excluded.home_result`,
        [matchupId, category, homeValue, awayValue, homeResult],
      );
    }

    await client.query(
      `insert into mlb_team (id, abbreviation, name, league, division)
       values
       (136, 'SEA', 'Seattle Mariners', 'American League', 'West'),
       (109, 'ARI', 'Arizona Diamondbacks', 'National League', 'West'),
       (144, 'ATL', 'Atlanta Braves', 'National League', 'East'),
       (113, 'CIN', 'Cincinnati Reds', 'National League', 'Central'),
       (110, 'BAL', 'Baltimore Orioles', 'American League', 'East'),
       (119, 'LAD', 'Los Angeles Dodgers', 'National League', 'West'),
       (116, 'DET', 'Detroit Tigers', 'American League', 'Central')
       on conflict (id) do update set abbreviation = excluded.abbreviation, name = excluded.name`,
    );

    for (const [id, mlbId, fullName, mlbTeamId, , positions, status] of players) {
      await client.query(
        `insert into player (id, mlb_player_id, full_name, current_mlb_team_id, status)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set mlb_player_id = excluded.mlb_player_id, full_name = excluded.full_name,
           current_mlb_team_id = excluded.current_mlb_team_id, status = excluded.status, updated_at = now()`,
        [id, mlbId, fullName, mlbTeamId, status],
      );

      for (const position of positions) {
        await client.query(
          `insert into player_position_eligibility (player_id, position, valid_from)
           values ($1, $2, '2026-01-01')
           on conflict (player_id, position, valid_from) do nothing`,
          [id, position],
        );
      }

      await client.query("delete from player_stat_line where player_id = $1 and source = 'seed'", [id]);
      for (const [split, stats] of Object.entries(playerStats[id] ?? {})) {
        await client.query(
          `insert into player_stat_line (player_id, stat_date, split, stats, source)
           values ($1, '2026-07-01', $2, $3::jsonb, 'seed')
           on conflict (player_id, stat_date, split, source)
           do update set stats = excluded.stats, collected_at = now()`,
          [id, split, JSON.stringify(stats)],
        );
      }

      const gameLogStats = positions.includes("P")
        ? [
            { date: "2026-06-29", stats: { W: 1, SV: positions.includes("RP") ? 1 : 0, K: 8, ERA: 2.25, WHIP: 0.91 } },
            { date: "2026-06-24", stats: { W: 0, SV: positions.includes("RP") ? 1 : 0, K: 6, ERA: 3.0, WHIP: 1.08 } },
            { date: "2026-06-19", stats: { W: 1, SV: 0, K: 9, ERA: 1.5, WHIP: 0.83 } },
          ]
        : [
            { date: "2026-06-29", stats: { R: 2, HR: 1, RBI: 3, SB: 1, AVG: 0.5 } },
            { date: "2026-06-28", stats: { R: 1, HR: 0, RBI: 1, SB: 0, AVG: 0.25 } },
            { date: "2026-06-27", stats: { R: 3, HR: 1, RBI: 2, SB: 1, AVG: 0.4 } },
          ];

      for (const [index, game] of gameLogStats.entries()) {
        await client.query(
          `insert into player_stat_line (player_id, stat_date, game_pk, split, stats, source)
           values ($1, $2::date, $3, 'game', $4::jsonb, 'seed')
           on conflict (player_id, stat_date, split, source)
           do update set game_pk = excluded.game_pk, stats = excluded.stats, collected_at = now()`,
          [id, game.date, Number(`${String(mlbId).slice(-4)}${index + 1}`), JSON.stringify(game.stats)],
        );
      }

      await client.query("delete from player_news where player_id = $1 and source = 'OFB Wire'", [id]);
      for (const [index, summary] of (playerNews[id] ?? []).entries()) {
        await client.query(
          `insert into player_news (player_id, source, headline, summary, published_at)
           values ($1, 'OFB Wire', $2, $3, $4::timestamptz)`,
          [
            id,
            index === 0 ? `${fullName} fantasy update` : `${fullName} usage note`,
            summary,
            index === 0 ? "2026-07-01T16:00:00Z" : "2026-07-01T14:00:00Z",
          ],
        );
      }
    }

    await client.query("delete from roster_entry where team_id = $1", [teams[0][0]]);
    for (const [, playerId] of lineup) {
      await client.query(
        `insert into roster_entry (team_id, player_id, acquisition_type)
         values ($1, $2, 'draft')`,
        [teams[0][0], playerId],
      );
    }

    await client.query("delete from lineup_entry where team_id = $1 and lineup_date = '2026-06-30'", [teams[0][0]]);
    for (const [slot, playerId] of lineup) {
      await client.query(
        `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
         values ($1, $2, $3, '2026-06-30', $4)`,
        [teams[0][0], playerId, periodId, slot],
      );
    }

    await client.query("commit");
    console.log("seeded OFB development data");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
