import { isUuid, query, withDemoFallback } from "@/lib/db/client";
import { players as mockPlayers } from "@/lib/fantasy/mock-data";
import { calculateSimplePoints } from "@/lib/fantasy/scoring";
import type { Player, PlayerDetail, PlayerGameLog, PlayerNewsItem, PlayerStatWindow, PlayerWatchItem } from "@/lib/fantasy/types";
import { mapPlayer, type DbPlayerRow } from "./mappers";

function mockPlayerWatch(): PlayerWatchItem[] {
  return mockPlayers
    .filter((player) => player.newsHeadline)
    .map((player) => ({ id: player.id, name: player.name, status: player.status, headline: player.newsHeadline! }));
}

/**
 * The team's rostered players that currently have recent news, most-recent
 * first. Backs the Team tab's per-player news indicators; falls back to the
 * mock roster's headlines in demo mode. "Recent" is a week: older items are
 * stale enough that flagging them next to the player reads as noise.
 */
export async function getPlayerWatchForTeam(teamId: string): Promise<PlayerWatchItem[]> {
  return withDemoFallback(
    async () => {
      const result = await query<{ id: string; full_name: string; status: Player["status"]; headline: string }>(
        `select p.id, p.full_name, p.status, latest_news.headline
         from roster_entry re
         join player p on p.id = re.player_id
         join lateral (
           select headline, published_at
           from player_news pn
           where pn.player_id = p.id and pn.published_at > now() - interval '7 days'
           order by published_at desc
           limit 1
         ) latest_news on true
         where re.team_id = $1 and re.dropped_at is null
         order by latest_news.published_at desc`,
        [teamId],
      );

      return result.rows.map((row) => ({
        id: row.id,
        name: row.full_name,
        status: row.status,
        headline: row.headline,
      }));
    },
    () => mockPlayerWatch(),
  );
}

export async function listPlayers(
  options: { query?: string; availability?: Player["availability"]; leagueId?: string } = {},
): Promise<Player[]> {
  return withDemoFallback(
    async () => {
      const values: unknown[] = [];
      const filters: string[] = [];

      if (options.query) {
        values.push(`%${options.query}%`);
        filters.push(`p.full_name ilike $${values.length}`);
      }

      // Rosters are per-league: scope "rostered" to the viewer's league when
      // known, so a player owned in another league still reads free-agent here.
      let rosterScope = "";

      if (options.leagueId && isUuid(options.leagueId)) {
        values.push(options.leagueId);
        rosterScope = `and league_id = $${values.length}`;
      }

      const result = await query<DbPlayerRow>(
        `
          select
            p.id,
            p.mlb_player_id,
            p.full_name,
            mt.abbreviation as mlb_team,
            p.status,
            coalesce(array_agg(distinct ppe.position order by ppe.position) filter (where ppe.position is not null), '{}') as positions,
            case when active_roster.player_id is null then 'free-agent' else 'rostered' end as availability,
            latest_news.headline as news_headline,
            coalesce(season_stats.stats, '{}'::jsonb) as season_stats,
            coalesce(projection_stats.stats, '{}'::jsonb) as projected_stats,
            p.season_fan_points,
            next_game.game_date,
            next_game.home_away,
            next_game.opponent,
            -- Real-world ownership from the ADP feed when known, else the share
            -- of this app's fantasy teams that roster the player.
            coalesce(
              adp.rostered_percent,
              round(
                100.0 * (select count(distinct re2.team_id) from roster_entry re2 where re2.player_id = p.id and re2.dropped_at is null)
                / greatest((select count(*) from fantasy_team), 1)
              )
            ) as rostered_percent
          from player p
          left join player_adp adp on adp.player_id = p.id
          left join mlb_team mt on mt.id = p.current_mlb_team_id
          left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
          left join (
            select distinct player_id
            from roster_entry
            where dropped_at is null ${rosterScope}
          ) active_roster on active_roster.player_id = p.id
          left join lateral (
            select headline from player_news pn where pn.player_id = p.id order by published_at desc limit 1
          ) latest_news on true
          left join lateral (
            select stats from player_stat_line psl where psl.player_id = p.id and split = 'season' order by stat_date desc limit 1
          ) season_stats on true
          left join lateral (
            select stats from player_stat_line psl where psl.player_id = p.id and split = 'projection_ros' order by stat_date desc limit 1
          ) projection_stats on true
          left join lateral (
            select
              g.game_date,
              case when g.home_mlb_team_id = p.current_mlb_team_id then 'home' else 'away' end as home_away,
              case when g.home_mlb_team_id = p.current_mlb_team_id then away.abbreviation else home.abbreviation end as opponent
            from mlb_game g
            left join mlb_team home on home.id = g.home_mlb_team_id
            left join mlb_team away on away.id = g.away_mlb_team_id
            where (g.home_mlb_team_id = p.current_mlb_team_id or g.away_mlb_team_id = p.current_mlb_team_id)
              and g.game_date >= now()
            order by g.game_date asc
            limit 1
          ) next_game on true
          ${filters.length ? `where ${filters.join(" and ")}` : ""}
          group by p.id, mt.abbreviation, active_roster.player_id, latest_news.headline, season_stats.stats, projection_stats.stats,
            p.season_fan_points, next_game.game_date, next_game.home_away, next_game.opponent, adp.rostered_percent
          order by p.full_name
          limit 500
        `,
        values,
      );

      const mapped = result.rows.map(mapPlayer);
      return options.availability ? mapped.filter((player) => player.availability === options.availability) : mapped;
    },
    () =>
      mockPlayers.filter((player) => {
        const matchesQuery = options.query ? player.name.toLowerCase().includes(options.query.toLowerCase()) : true;
        const matchesAvailability = options.availability ? player.availability === options.availability : true;
        return matchesQuery && matchesAvailability;
      }),
  );
}

type PlayerDetailRow = DbPlayerRow & {
  mlb_player_id: number | null;
  team_name: string | null;
  jersey_number: string | null;
  current_mlb_team_id: number | null;
  season_fan_points: string | number | null;
};

type PlayerValueRow = {
  rank_ahead: string | number;
  total_ranked: string | number;
  rostered_teams: string | number;
  total_teams: string | number;
  external_rostered_percent: string | number | null;
};

type PlayerNextGameRow = {
  game_date: Date | string;
  venue_name: string | null;
  home_away: "home" | "away";
  opponent: string | null;
};

type PlayerNewsRow = {
  id: string;
  source: string;
  source_url: string | null;
  headline: string;
  summary: string | null;
  published_at: Date | string;
};

type PlayerStatLineRow = {
  split: PlayerStatWindow["split"];
  stats: Record<string, number | string>;
  collected_at: Date | string;
};

type PlayerGameLogRow = {
  id: string;
  game_pk: number | null;
  stat_date: Date | string;
  stats: Record<string, number | string>;
};

export async function getPlayerDetail(playerId: string, teamId?: string): Promise<PlayerDetail | null> {
  return withDemoFallback(
    async () => {
      const playerResult = await query<PlayerDetailRow>(
        `
          select
            p.id,
            p.mlb_player_id,
            p.full_name,
            p.jersey_number,
            p.current_mlb_team_id,
            p.season_fan_points,
            mt.abbreviation as mlb_team,
            mt.name as team_name,
            p.status,
            coalesce(array_agg(distinct ppe.position order by ppe.position) filter (where ppe.position is not null), '{}') as positions,
            case when active_roster.player_id is null then 'free-agent' else 'rostered' end as availability,
            latest_news.headline as news_headline,
            coalesce(season_stats.stats, '{}'::jsonb) as season_stats,
            coalesce(projection_stats.stats, '{}'::jsonb) as projected_stats
          from player p
          left join mlb_team mt on mt.id = p.current_mlb_team_id
          left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
          left join (
            select distinct player_id
            from roster_entry
            where dropped_at is null
          ) active_roster on active_roster.player_id = p.id
          left join lateral (
            select headline from player_news pn where pn.player_id = p.id order by published_at desc limit 1
          ) latest_news on true
          left join lateral (
            select stats from player_stat_line psl where psl.player_id = p.id and split = 'season' order by stat_date desc limit 1
          ) season_stats on true
          left join lateral (
            select stats from player_stat_line psl where psl.player_id = p.id and split = 'projection_ros' order by stat_date desc limit 1
          ) projection_stats on true
          where p.id = $1
          group by p.id, mt.abbreviation, mt.name, active_roster.player_id, latest_news.headline, season_stats.stats, projection_stats.stats
          limit 1
        `,
        [playerId],
      );
      const playerRow = playerResult.rows[0];

      if (!playerRow) {
        return null;
      }

      const [newsResult, statsResult, gameLogResult, nextGameResult, valueResult, rosterMembershipResult] =
        await Promise.all([
        query<PlayerNewsRow>(
          `select id, source, source_url, headline, summary, published_at
           from player_news
           where player_id = $1
           order by published_at desc
           limit 5`,
          [playerId],
        ),
        query<PlayerStatLineRow>(
          `select split, stats, collected_at
           from (
             select distinct on (split) split, stats, collected_at, stat_date
             from player_stat_line
             where player_id = $1 and split in ('season', 'last_7', 'last_14', 'last_30', 'projection_ros')
             order by split, stat_date desc, collected_at desc
           ) latest
           order by
             case split
               when 'season' then 0
               when 'last_7' then 1
               when 'last_14' then 2
               when 'last_30' then 3
               when 'projection_ros' then 4
               else 5
             end`,
          [playerId],
        ),
        query<PlayerGameLogRow>(
          // stat_date is a calendar date; cast to text so node-pg doesn't turn
          // it into a Date at server-local midnight, which shifts a day when
          // serialized across timezones.
          `select id, game_pk, stat_date::text as stat_date, stats
           from player_stat_line
           where player_id = $1 and split = 'game'
           order by stat_date desc
           limit 10`,
          [playerId],
        ),
        query<PlayerNextGameRow>(
          `select g.game_date, g.venue_name,
             case when g.home_mlb_team_id = $1 then 'home' else 'away' end as home_away,
             case when g.home_mlb_team_id = $1 then away.abbreviation else home.abbreviation end as opponent
           from mlb_game g
           left join mlb_team home on home.id = g.home_mlb_team_id
           left join mlb_team away on away.id = g.away_mlb_team_id
           where (g.home_mlb_team_id = $1 or g.away_mlb_team_id = $1) and g.game_date >= now()
           order by g.game_date asc
           limit 1`,
          [playerRow.current_mlb_team_id],
        ),
        query<PlayerValueRow>(
          `select
             (select count(*) from player x where x.season_fan_points > p.season_fan_points) as rank_ahead,
             (select count(*) from player x where x.season_fan_points is not null) as total_ranked,
             (select count(distinct re.team_id) from roster_entry re where re.player_id = p.id and re.dropped_at is null) as rostered_teams,
             (select count(*) from fantasy_team) as total_teams,
             (select rostered_percent from player_adp where player_id = p.id) as external_rostered_percent
           from player p
           where p.id = $1`,
          [playerId],
        ),
        // Whether the player is on the *current* team's active roster. Drives
        // the drop/IL/NA controls, which only apply to your own roster.
        teamId && isUuid(teamId)
          ? query<{ on_team: boolean }>(
              `select exists (
                 select 1 from roster_entry where team_id = $1 and player_id = $2 and dropped_at is null
               ) as on_team`,
              [teamId, playerId],
            )
          : Promise.resolve({ rows: [{ on_team: false }] as { on_team: boolean }[] }),
      ]);

      const onCurrentTeam = rosterMembershipResult.rows[0]?.on_team ?? false;
      const player = mapPlayer(playerRow);
      let availability = player.availability;

      // Rosters are per-league: when viewing from a team, "rostered" must mean
      // rostered in THAT league, not anywhere in the app.
      if (teamId && isUuid(teamId)) {
        const scoped = await query<{ rostered: boolean }>(
          `select exists (
             select 1 from roster_entry re
             where re.player_id = $2 and re.dropped_at is null
               and re.league_id = (select league_id from fantasy_team where id = $1)
           ) as rostered`,
          [teamId, playerId],
        );
        availability = scoped.rows[0]?.rostered ? "rostered" : "free-agent";
      }

      // Waiver context for the current team's league: whether the player is
      // clearing waivers, this team's pending claim, and the league's waiver
      // economy (mode + remaining FAAB) for the claim UI.
      let waiver: PlayerDetail["waiver"] = null;

      if (teamId && isUuid(teamId) && availability !== "rostered") {
        const waiverRow = await query<{
          waiver_until: Date | null;
          has_claim: boolean;
          waiver_mode: string | null;
          faab_remaining: string | number | null;
        }>(
          `select
             (select max(re.waiver_until)
              from roster_entry re
              where re.league_id = ft.league_id and re.player_id = $2
                and re.dropped_at is not null and re.waiver_until > now()) as waiver_until,
             exists (
               select 1 from waiver_claim wc
               where wc.team_id = ft.id and wc.add_player_id = $2 and wc.status = 'pending'
             ) as has_claim,
             l.settings->>'waiverMode' as waiver_mode,
             ft.faab_remaining
           from fantasy_team ft
           join league l on l.id = ft.league_id
           where ft.id = $1`,
          [teamId, playerId],
        );
        const row = waiverRow.rows[0];

        if (row && (row.waiver_until || row.has_claim)) {
          waiver = {
            until: row.waiver_until ? new Date(row.waiver_until).toISOString() : null,
            myClaimPending: row.has_claim,
            mode: row.waiver_mode === "faab" ? "faab" : "rolling",
            faabRemaining: row.faab_remaining != null ? Number(row.faab_remaining) : null,
          };
        }
      }
      const nextGameRow = nextGameResult.rows[0];
      const fanPoints = playerRow.season_fan_points != null ? Math.round(Number(playerRow.season_fan_points)) : null;
      const valueRow = valueResult.rows[0];
      const totalTeams = valueRow ? Number(valueRow.total_teams) : 0;
      // Prefer real-world ownership from the ADP feed; fall back to this app's
      // own team ownership only when a player isn't in the external set.
      const externalRosteredPercent =
        valueRow?.external_rostered_percent != null ? Math.round(Number(valueRow.external_rostered_percent)) : null;
      const internalRosteredPercent =
        valueRow && totalTeams > 0 ? Math.round((Number(valueRow.rostered_teams) / totalTeams) * 100) : null;

      return {
        ...player,
        mlbPlayerId: playerRow.mlb_player_id,
        teamName: playerRow.team_name,
        jerseyNumber: playerRow.jersey_number,
        value: {
          fanPoints,
          rank: fanPoints != null && valueRow ? Number(valueRow.rank_ahead) + 1 : null,
          totalRanked: valueRow ? Number(valueRow.total_ranked) : 0,
          rosteredPercent: externalRosteredPercent ?? internalRosteredPercent,
        },
        nextGame: nextGameRow
          ? {
              date: new Date(nextGameRow.game_date).toISOString(),
              opponent: nextGameRow.opponent,
              homeAway: nextGameRow.home_away,
              venue: nextGameRow.venue_name,
            }
          : null,
        news: newsResult.rows.map(mapNewsItem),
        statWindows: statsResult.rows.map(mapStatWindow),
        gameLog: gameLogResult.rows.map(mapGameLog),
        availability: waiver?.until ? "waivers" : availability,
        waiver,
        management: {
          // Unrostered players are added directly unless they're clearing
          // waivers, in which case the path is a claim. Drop, IL, and NA act
          // on the current team's roster, so they require membership.
          canAdd: availability !== "rostered" && !waiver?.until,
          canClaim: Boolean(waiver?.until) && !waiver?.myClaimPending,
          canCancelClaim: Boolean(waiver?.myClaimPending),
          canDrop: onCurrentTeam,
          canMoveToIL: onCurrentTeam && (player.status === "injured" || player.status === "day-to-day"),
          canMoveToNA: onCurrentTeam && player.status === "minors",
        },
      };
    },
    () => mockPlayerDetail(playerId),
  );
}

function mockPlayerDetail(playerId: string): PlayerDetail | null {
  const player = mockPlayers.find((candidate) => candidate.id === playerId) ?? mockPlayers[0];

  if (!player) {
    return null;
  }

  return {
    ...player,
    mlbPlayerId: player.mlbPlayerId ?? null,
    teamName: player.mlbTeam,
    jerseyNumber: null,
    value: {
      fanPoints: Math.round(calculateSimplePoints(player)),
      rank: null,
      totalRanked: 0,
      rosteredPercent: null,
    },
    nextGame: null,
    news: [
      {
        id: "mock-news-1",
        source: "OFB Wire",
        headline: player.newsHeadline ?? `${player.name} remains on the fantasy radar.`,
        summary: "Mock player update shown when the database is unavailable.",
        publishedAt: new Date().toISOString(),
      },
    ],
    statWindows: [
      { split: "season", label: "Season", stats: player.seasonStats },
      { split: "projection_ros", label: "ROS Projection", stats: player.projectedStats },
    ],
    gameLog: [
      {
        id: "mock-game-1",
        gamePk: null,
        date: new Date().toISOString(),
        stats: player.seasonStats,
      },
    ],
    management: {
      canAdd: player.availability !== "rostered",
      canDrop: player.availability === "rostered",
      canMoveToIL: player.status === "injured" || player.status === "day-to-day",
      canMoveToNA: player.status === "minors",
    },
  };
}

function mapNewsItem(row: PlayerNewsRow): PlayerNewsItem {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    headline: row.headline,
    summary: row.summary ?? undefined,
    publishedAt: new Date(row.published_at).toISOString(),
  };
}

function mapGameLog(row: PlayerGameLogRow): PlayerGameLog {
  return {
    id: row.id,
    gamePk: row.game_pk,
    date: new Date(row.stat_date).toISOString(),
    stats: row.stats,
  };
}

function mapStatWindow(row: PlayerStatLineRow): PlayerStatWindow {
  return {
    split: row.split,
    label: statWindowLabel(row.split),
    stats: row.stats,
    collectedAt: new Date(row.collected_at).toISOString(),
  };
}

function statWindowLabel(split: PlayerStatWindow["split"]) {
  switch (split) {
    case "season":
      return "Season";
    case "last_7":
      return "Last 7";
    case "last_14":
      return "Last 14";
    case "last_30":
      return "Last 30";
    case "projection_ros":
      return "ROS Projection";
  }
}
