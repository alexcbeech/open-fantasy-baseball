import { query, tryDatabase } from "@/lib/db/client";
import { players as mockPlayers } from "@/lib/fantasy/mock-data";
import type { Player, PlayerDetail, PlayerGameLog, PlayerNewsItem, PlayerStatWindow } from "@/lib/fantasy/types";
import { mapPlayer, type DbPlayerRow } from "./mappers";

export async function listPlayers(options: { query?: string; availability?: Player["availability"] } = {}): Promise<Player[]> {
  return tryDatabase(
    async () => {
      const values: unknown[] = [];
      const filters: string[] = [];

      if (options.query) {
        values.push(`%${options.query}%`);
        filters.push(`p.full_name ilike $${values.length}`);
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
          ${filters.length ? `where ${filters.join(" and ")}` : ""}
          group by p.id, mt.abbreviation, active_roster.player_id, latest_news.headline, season_stats.stats, projection_stats.stats
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

export async function getPlayerDetail(playerId: string): Promise<PlayerDetail | null> {
  return tryDatabase(
    async () => {
      const playerResult = await query<PlayerDetailRow>(
        `
          select
            p.id,
            p.mlb_player_id,
            p.full_name,
            p.jersey_number,
            p.current_mlb_team_id,
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

      const [newsResult, statsResult, gameLogResult, nextGameResult] = await Promise.all([
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
          `select id, game_pk, stat_date, stats
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
      ]);

      const player = mapPlayer(playerRow);
      const nextGameRow = nextGameResult.rows[0];

      return {
        ...player,
        mlbPlayerId: playerRow.mlb_player_id,
        teamName: playerRow.team_name,
        jerseyNumber: playerRow.jersey_number,
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
        management: {
          canAdd: player.availability !== "rostered",
          canDrop: player.availability === "rostered",
          canMoveToIL: player.status === "injured" || player.status === "day-to-day",
          canMoveToNA: player.status === "minors",
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
