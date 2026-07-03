import type { PoolClient } from "pg";
import { getPool } from "../db/client";

const defaultBaseUrl = process.env.MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com/api/v1";
const source = "mlb-stats-api";

type StatMap = Record<string, number | string>;

// MLB Stats API field names → OFB stat categories.
const HITTING_MAP: Record<string, string> = { runs: "R", homeRuns: "HR", rbi: "RBI", stolenBases: "SB", avg: "AVG" };
const PITCHING_MAP: Record<string, string> = { wins: "W", saves: "SV", strikeOuts: "K", era: "ERA", whip: "WHIP" };
const RATE_KEYS = new Set(["AVG", "ERA", "WHIP"]);

const recentSplits: Array<{ split: string; days: number }> = [
  { split: "last_7", days: 6 },
  { split: "last_14", days: 13 },
  { split: "last_30", days: 29 },
];

type MlbSplit = {
  player?: { id?: number };
  stat?: Record<string, unknown>;
  date?: string;
  game?: { gamePk?: number };
};

type MlbStatBlock = {
  group?: { displayName?: string };
  type?: { displayName?: string };
  splits?: MlbSplit[];
};

type MlbStatsResponse = { stats?: MlbStatBlock[] };

export type SyncPlayerStatsResult = {
  ingestionRunId: string;
  season: number;
  rowsSeen: number;
  rowsWritten: number;
  rosteredPlayers: number;
  status: "succeeded";
  source: string;
};

async function fetchJson<T>(path: string, baseUrl: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`MLB Stats API request failed: ${response.status} ${response.statusText} ${path}`);
  }

  return response.json() as Promise<T>;
}

export function mapMlbStat(stat: Record<string, unknown> | undefined, group: "hitting" | "pitching"): StatMap {
  const map = group === "pitching" ? PITCHING_MAP : HITTING_MAP;
  const out: StatMap = {};

  if (!stat) {
    return out;
  }

  for (const [mlbKey, ofbKey] of Object.entries(map)) {
    const value = stat[mlbKey];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    out[ofbKey] = RATE_KEYS.has(ofbKey) ? String(value) : Number(value);
  }

  return out;
}

function blockGroup(block: MlbStatBlock): "hitting" | "pitching" {
  return block.group?.displayName === "pitching" ? "pitching" : "hitting";
}

async function detectCurrentSeason(baseUrl: string, today: Date): Promise<number> {
  try {
    const payload = await fetchJson<{ seasons?: Array<{ seasonId?: string }> }>(`/seasons/current?sportId=1`, baseUrl);
    const id = payload.seasons?.[0]?.seasonId;
    if (id) {
      return Number(id);
    }
  } catch {
    // Fall through to the calendar year.
  }
  return today.getUTCFullYear();
}

/**
 * Ingest real 2026 stats from the MLB Stats API into player_stat_line:
 * season stats for every player we know (via the bulk leaderboard) plus full
 * game logs and trailing 7/14/30-day splits for rostered players. Writes with
 * source 'mlb-stats-api' so getPlayerDetail's latest-per-split query surfaces
 * them over the seeded rows.
 */
export async function syncPlayerStats(baseUrl = defaultBaseUrl, today = new Date()): Promise<SyncPlayerStatsResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const season = await detectCurrentSeason(baseUrl, today);
    const statDate = today.toISOString().slice(0, 10);
    const ingestion = await client.query<{ id: string }>(
      `insert into ingestion_run (source, job_type, status) values ($1, 'player-stats', 'started') returning id`,
      [source],
    );
    const ingestionRunId = ingestion.rows[0].id;
    let rowsSeen = 0;
    let rowsWritten = 0;
    let rosteredPlayers = 0;

    try {
      const players = await client.query<{ id: string; mlb_player_id: number }>(
        `select id, mlb_player_id from player where mlb_player_id is not null`,
      );
      const idByMlb = new Map<number, string>(players.rows.map((row) => [row.mlb_player_id, row.id]));

      const upsert = async (playerId: string, date: string, split: string, stats: StatMap, gamePk: number | null = null) => {
        await client.query(
          `insert into player_stat_line (player_id, stat_date, game_pk, split, stats, source)
           values ($1, $2, $3, $4, $5::jsonb, $6)
           on conflict (player_id, stat_date, split, source) do update set
             stats = excluded.stats,
             game_pk = excluded.game_pk,
             collected_at = now()`,
          [playerId, date, gamePk, split, JSON.stringify(stats), source],
        );
        rowsWritten += 1;
      };

      // 1) Bulk season stats for every player we can match by MLB id.
      for (const group of ["hitting", "pitching"] as const) {
        const limit = 1000;
        let offset = 0;

        for (;;) {
          const payload = await fetchJson<MlbStatsResponse>(
            `/stats?stats=season&group=${group}&season=${season}&sportId=1&gameType=R&limit=${limit}&offset=${offset}`,
            baseUrl,
          );
          const splits = payload.stats?.[0]?.splits ?? [];

          for (const split of splits) {
            rowsSeen += 1;
            const playerId = split.player?.id != null ? idByMlb.get(split.player.id) : undefined;
            if (!playerId) {
              continue;
            }
            const stats = mapMlbStat(split.stat, group);
            if (Object.keys(stats).length) {
              await upsert(playerId, statDate, "season", stats);
            }
          }

          if (splits.length < limit) {
            break;
          }
          offset += limit;
        }
      }

      // 2) Rostered players get full detail: season (guaranteed), game log, splits.
      const rostered = await client.query<{ id: string; mlb_player_id: number }>(
        `select distinct p.id, p.mlb_player_id
         from roster_entry re
         join player p on p.id = re.player_id
         where re.dropped_at is null and p.mlb_player_id is not null`,
      );
      rosteredPlayers = rostered.rows.length;

      for (const player of rostered.rows) {
        await syncRosteredPlayer(client, baseUrl, season, statDate, today, player, upsert, () => {
          rowsSeen += 1;
        });
      }

      // Real data supersedes the seeded placeholder lines for the same
      // player+split, so the detail view stops interleaving fake games.
      await client.query(
        `delete from player_stat_line seed
         where seed.source = 'seed'
           and exists (
             select 1 from player_stat_line live
             where live.player_id = seed.player_id and live.split = seed.split and live.source = $1
           )`,
        [source],
      );

      await client.query(`update ingestion_run set status = 'succeeded', finished_at = now(), rows_seen = $1 where id = $2`, [
        rowsSeen,
        ingestionRunId,
      ]);

      return { ingestionRunId, season, rowsSeen, rowsWritten, rosteredPlayers, status: "succeeded", source };
    } catch (error) {
      await client
        .query(`update ingestion_run set status = 'failed', finished_at = now(), rows_seen = $1, error_message = $2 where id = $3`, [
          rowsSeen,
          error instanceof Error ? error.message : String(error),
          ingestionRunId,
        ])
        .catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

async function syncRosteredPlayer(
  client: PoolClient,
  baseUrl: string,
  season: number,
  statDate: string,
  today: Date,
  player: { id: string; mlb_player_id: number },
  upsert: (playerId: string, date: string, split: string, stats: StatMap, gamePk?: number | null) => Promise<void>,
  seen: () => void,
) {
  const seasonPayload = await fetchJson<MlbStatsResponse>(
    `/people/${player.mlb_player_id}/stats?stats=season&group=hitting,pitching&season=${season}`,
    baseUrl,
  );
  for (const block of seasonPayload.stats ?? []) {
    const stats = mapMlbStat(block.splits?.[0]?.stat, blockGroup(block));
    if (Object.keys(stats).length) {
      seen();
      await upsert(player.id, statDate, "season", stats);
    }
  }

  const gameLog = await fetchJson<MlbStatsResponse>(
    `/people/${player.mlb_player_id}/stats?stats=gameLog&group=hitting,pitching&season=${season}`,
    baseUrl,
  );
  for (const block of gameLog.stats ?? []) {
    const group = blockGroup(block);
    for (const split of (block.splits ?? []).slice(-12)) {
      if (!split.date) {
        continue;
      }
      const stats = mapMlbStat(split.stat, group);
      if (Object.keys(stats).length) {
        seen();
        await upsert(player.id, split.date, "game", stats, split.game?.gamePk ?? null);
      }
    }
  }

  for (const { split, days } of recentSplits) {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - days);
    const startDate = start.toISOString().slice(0, 10);
    const payload = await fetchJson<MlbStatsResponse>(
      `/people/${player.mlb_player_id}/stats?stats=byDateRange&startDate=${startDate}&endDate=${statDate}&group=hitting,pitching&season=${season}`,
      baseUrl,
    );
    for (const block of payload.stats ?? []) {
      const stats = mapMlbStat(block.splits?.[0]?.stat, blockGroup(block));
      if (Object.keys(stats).length) {
        seen();
        await upsert(player.id, statDate, split, stats);
      }
    }
  }
}
