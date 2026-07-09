import type { PoolClient } from "pg";
import { getPool } from "../db/client";
import { calculateFantasyPoints } from "../fantasy/scoring";
import { chunk, mapWithConcurrency } from "./batching";

const defaultBaseUrl = process.env.MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com/api/v1";
const source = "mlb-stats-api";

// The MLB Stats API has no published rate limit but throttles aggressive
// clients; a small pool keeps the sync fast without hammering it.
const fetchConcurrency = 8;
// Rows per multi-row insert. Well under the 65,535-parameter limit at our
// column counts; mainly bounds statement size.
const writeChunkSize = 500;

type StatMap = Record<string, number | string>;

// MLB Stats API field names → OFB stat categories. H/AB and IP/ER/BB/HA are
// carried so team rate categories (AVG/ERA/WHIP) can be recomputed from
// components rather than averaged; they are not shown in the primary stat list.
const HITTING_MAP: Record<string, string> = {
  runs: "R",
  homeRuns: "HR",
  rbi: "RBI",
  stolenBases: "SB",
  avg: "AVG",
  hits: "H",
  atBats: "AB",
};
const PITCHING_MAP: Record<string, string> = {
  wins: "W",
  saves: "SV",
  strikeOuts: "K",
  era: "ERA",
  whip: "WHIP",
  inningsPitched: "IP",
  earnedRuns: "ER",
  baseOnBalls: "BB",
  hits: "HA",
};
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
  // Timeout so a hung upstream request fails the job instead of stalling it
  // until the stale-job reclaimer burns an attempt.
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(30_000) });

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

// A pitcher needs at least this many starts (or relief appearances) to gain
// starter (or reliever) eligibility, mirroring the appearance-based rules
// familiar fantasy platforms use.
const PITCHER_ROLE_APPEARANCE_THRESHOLD = 3;

/**
 * Derive fantasy starter/reliever eligibility from a pitcher's season usage.
 * The MLB roster feed only labels pitchers "P", so SP/RP roster slots would be
 * unfillable without this. Starters and relievers each qualify once they clear
 * the appearance threshold, so a swingman earns both; a small early-season
 * sample falls back to the role the pitcher has been used in most. An empty
 * result (no appearances yet) is left to the slot-eligibility backfill.
 */
export function derivePitcherEligibility(gamesStarted: number, gamesPlayed: number): Array<"SP" | "RP"> {
  const starts = Number.isFinite(gamesStarted) ? Math.max(0, Math.trunc(gamesStarted)) : 0;
  const rawGames = Number.isFinite(gamesPlayed) ? Math.max(0, Math.trunc(gamesPlayed)) : 0;
  // A start is always an appearance, so treat games as at least the start
  // count; this also guards against missing/contradictory games-played data.
  const games = Math.max(rawGames, starts);
  const reliefAppearances = games - starts;
  const positions: Array<"SP" | "RP"> = [];

  if (starts >= PITCHER_ROLE_APPEARANCE_THRESHOLD) {
    positions.push("SP");
  }

  if (reliefAppearances >= PITCHER_ROLE_APPEARANCE_THRESHOLD) {
    positions.push("RP");
  }

  if (positions.length === 0 && games > 0) {
    positions.push(starts >= reliefAppearances ? "SP" : "RP");
  }

  return positions;
}

/**
 * Starter/reliever eligibility rows for one pitcher derived from a season
 * pitching stat block. Empty for players with no pitching appearances yet.
 */
function pitcherEligibilityRows(playerId: string, stat: Record<string, unknown> | undefined): EligibilityRow[] {
  if (!stat) {
    return [];
  }

  return derivePitcherEligibility(Number(stat.gamesStarted ?? 0), Number(stat.gamesPlayed ?? 0)).map((position) => ({
    playerId,
    position,
  }));
}

type StatLineRow = {
  playerId: string;
  statDate: string;
  gamePk: number | null;
  split: string;
  stats: StatMap;
};

type EligibilityRow = { playerId: string; position: string };

/**
 * Multi-row upsert of stat lines. The feed can emit two rows for one conflict
 * key (e.g. both games of a doubleheader share stat_date + split 'game'), and
 * a multi-row insert can't touch a row twice, so dedupe keeping the last
 * occurrence — the same end state the sequential upserts produced.
 * Returns the number of rows written.
 */
async function flushStatLines(client: PoolClient, rows: StatLineRow[]) {
  const rowByKey = new Map<string, StatLineRow>();
  for (const row of rows) {
    rowByKey.set(`${row.playerId}|${row.statDate}|${row.split}`, row);
  }
  const unique = [...rowByKey.values()];

  for (const batch of chunk(unique, writeChunkSize)) {
    await client.query(
      `insert into player_stat_line (player_id, stat_date, game_pk, split, stats, source)
       select t.player_id, t.stat_date, t.game_pk, t.split, t.stats, $6
       from unnest($1::uuid[], $2::date[], $3::integer[], $4::text[], $5::jsonb[])
         as t(player_id, stat_date, game_pk, split, stats)
       on conflict (player_id, stat_date, split, source) do update set
         stats = excluded.stats,
         game_pk = excluded.game_pk,
         collected_at = now()`,
      [
        batch.map((row) => row.playerId),
        batch.map((row) => row.statDate),
        batch.map((row) => row.gamePk),
        batch.map((row) => row.split),
        batch.map((row) => JSON.stringify(row.stats)),
        source,
      ],
    );
  }

  return unique.length;
}

async function flushFanPoints(client: PoolClient, pointsByPlayerId: Map<string, number>) {
  for (const batch of chunk([...pointsByPlayerId.entries()], writeChunkSize)) {
    await client.query(
      `update player set season_fan_points = t.points
       from unnest($1::uuid[], $2::numeric[]) as t(id, points)
       where player.id = t.id`,
      [batch.map(([playerId]) => playerId), batch.map(([, points]) => points)],
    );
  }
}

async function flushEligibility(client: PoolClient, rows: EligibilityRow[]) {
  const rowByKey = new Map(rows.map((row) => [`${row.playerId}|${row.position}`, row]));

  for (const batch of chunk([...rowByKey.values()], writeChunkSize)) {
    await client.query(
      `insert into player_position_eligibility (player_id, position, source, valid_from)
       select t.player_id, t.position, $3, current_date
       from unnest($1::uuid[], $2::text[]) as t(player_id, position)
       on conflict (player_id, position, valid_from) do nothing`,
      [batch.map((row) => row.playerId), batch.map((row) => row.position), source],
    );
  }
}

/**
 * Ensure every pitcher can fill a dedicated SP or RP slot even without season
 * stats (non-qualified relievers, early-season/rookie arms). Probable starters
 * gain SP; any remaining "P"-only pitcher gets RP so the slot is fillable.
 * Idempotent, and run after any precise stats-based derivation so it only fills
 * the gaps. Shared by the teams/rosters sync and the stats sync.
 */
export async function backfillPitcherSlotEligibility(client: PoolClient) {
  // Scheduled starters are starters, even before they clear the start threshold.
  await client.query(
    `insert into player_position_eligibility (player_id, position, source, valid_from)
     select distinct probable.player_id, 'SP', $1, current_date
     from (
       select home_probable_pitcher_player_id as player_id from mlb_game where home_probable_pitcher_player_id is not null
       union
       select away_probable_pitcher_player_id from mlb_game where away_probable_pitcher_player_id is not null
     ) probable
     where not exists (
       select 1 from player_position_eligibility existing
       where existing.player_id = probable.player_id and existing.position = 'SP' and existing.valid_to is null
     )
     on conflict (player_id, position, valid_from) do nothing`,
    [source],
  );

  // Any pitcher still lacking a dedicated slot defaults to reliever.
  await client.query(
    `insert into player_position_eligibility (player_id, position, source, valid_from)
     select distinct pitcher.player_id, 'RP', $1, current_date
     from player_position_eligibility pitcher
     where pitcher.position = 'P' and pitcher.valid_to is null
       and not exists (
         select 1 from player_position_eligibility dedicated
         where dedicated.player_id = pitcher.player_id
           and dedicated.position in ('SP', 'RP') and dedicated.valid_to is null
       )
     on conflict (player_id, position, valid_from) do nothing`,
    [source],
  );
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
 * season stats for every player we know (via the bulk leaderboard), full game
 * logs and trailing 7/14/30-day splits for rostered players, and game logs for
 * qualified free agents (anyone with season stats) so any player the user can
 * open has a real game log. Writes with source 'mlb-stats-api' so
 * getPlayerDetail's latest-per-split query surfaces them over the seeded rows.
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

      // 1) Bulk season stats for every player we can match by MLB id.
      const seasonLines: StatLineRow[] = [];
      const seasonFanPoints = new Map<string, number>();
      const seasonEligibility: EligibilityRow[] = [];

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
              seasonLines.push({ playerId, statDate, gamePk: null, split: "season", stats });
              seasonFanPoints.set(playerId, calculateFantasyPoints(stats));
            }
            if (group === "pitching") {
              seasonEligibility.push(...pitcherEligibilityRows(playerId, split.stat));
            }
          }

          if (splits.length < limit) {
            break;
          }
          offset += limit;
        }
      }

      rowsWritten += await flushStatLines(client, seasonLines);
      await flushFanPoints(client, seasonFanPoints);
      await flushEligibility(client, seasonEligibility);

      // 2) Rostered players get full detail: season (guaranteed), game log, splits.
      const rostered = await client.query<{ id: string; mlb_player_id: number }>(
        `select distinct p.id, p.mlb_player_id
         from roster_entry re
         join player p on p.id = re.player_id
         where re.dropped_at is null and p.mlb_player_id is not null`,
      );
      rosteredPlayers = rostered.rows.length;

      const rosteredResults = await mapWithConcurrency(rostered.rows, fetchConcurrency, (player) =>
        fetchRosteredPlayerStats(baseUrl, season, statDate, today, player),
      );

      const rosteredLines: StatLineRow[] = [];
      const rosteredFanPoints = new Map<string, number>();
      const rosteredEligibility: EligibilityRow[] = [];

      for (const result of rosteredResults) {
        rowsSeen += result.rowsSeen;
        rosteredLines.push(...result.statLines);
        rosteredEligibility.push(...result.eligibility);
        if (result.fanPoints !== undefined) {
          rosteredFanPoints.set(result.playerId, result.fanPoints);
        }
      }

      rowsWritten += await flushStatLines(client, rosteredLines);
      await flushFanPoints(client, rosteredFanPoints);
      await flushEligibility(client, rosteredEligibility);

      // 3) Non-rostered players with season stats (qualified free agents the
      // user can browse and open) get a real game log too -- just the log, not
      // the per-player season/split calls, keeping this pass to one request each.
      const freeAgents = await client.query<{ id: string; mlb_player_id: number }>(
        `select p.id, p.mlb_player_id
         from player p
         where p.mlb_player_id is not null
           and p.season_fan_points is not null
           and not exists (
             select 1 from roster_entry re
             where re.player_id = p.id and re.dropped_at is null
           )`,
      );

      const freeAgentLines = (
        await mapWithConcurrency(freeAgents.rows, fetchConcurrency, (player) =>
          fetchPlayerGameLogRows(baseUrl, season, player),
        )
      ).flat();
      rowsSeen += freeAgentLines.length;
      rowsWritten += await flushStatLines(client, freeAgentLines);

      // Fill SP/RP eligibility gaps for pitchers the leaderboard didn't cover
      // (non-qualified relievers, early-season arms) so dedicated pitching
      // slots are fillable across the whole player pool.
      await backfillPitcherSlotEligibility(client);

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

/**
 * Fetch one rostered player's full detail (season, game log, trailing splits)
 * and map it to writeable rows. Fetch-and-map only — no database access — so
 * players can be crawled concurrently and written in batches afterwards.
 */
async function fetchRosteredPlayerStats(
  baseUrl: string,
  season: number,
  statDate: string,
  today: Date,
  player: { id: string; mlb_player_id: number },
) {
  const statLines: StatLineRow[] = [];
  const eligibility: EligibilityRow[] = [];
  let fanPoints: number | undefined;
  let rowsSeen = 0;

  const seasonPayload = await fetchJson<MlbStatsResponse>(
    `/people/${player.mlb_player_id}/stats?stats=season&group=hitting,pitching&season=${season}`,
    baseUrl,
  );
  for (const block of seasonPayload.stats ?? []) {
    const group = blockGroup(block);
    const stats = mapMlbStat(block.splits?.[0]?.stat, group);
    if (Object.keys(stats).length) {
      rowsSeen += 1;
      statLines.push({ playerId: player.id, statDate, gamePk: null, split: "season", stats });
      fanPoints = calculateFantasyPoints(stats);
    }
    if (group === "pitching") {
      eligibility.push(...pitcherEligibilityRows(player.id, block.splits?.[0]?.stat));
    }
  }

  const gameLogRows = await fetchPlayerGameLogRows(baseUrl, season, player);
  rowsSeen += gameLogRows.length;
  statLines.push(...gameLogRows);

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
        rowsSeen += 1;
        statLines.push({ playerId: player.id, statDate, gamePk: null, split, stats });
      }
    }
  }

  return { playerId: player.id, statLines, eligibility, fanPoints, rowsSeen };
}

/**
 * Fetch a player's game log and map the most recent games to writeable rows.
 * Shared by the rostered full-detail crawl and the leaner non-rostered pass so
 * any player the user can click (rostered or a qualified free agent) has a
 * real game log.
 */
async function fetchPlayerGameLogRows(
  baseUrl: string,
  season: number,
  player: { id: string; mlb_player_id: number },
): Promise<StatLineRow[]> {
  const gameLog = await fetchJson<MlbStatsResponse>(
    `/people/${player.mlb_player_id}/stats?stats=gameLog&group=hitting,pitching&season=${season}`,
    baseUrl,
  );
  const rows: StatLineRow[] = [];

  for (const block of gameLog.stats ?? []) {
    const group = blockGroup(block);
    for (const split of (block.splits ?? []).slice(-12)) {
      if (!split.date) {
        continue;
      }
      const stats = mapMlbStat(split.stat, group);
      // The feed's game-log AVG/ERA/WHIP are season-to-date, not per-game, so
      // drop them; the per-game counting stats and H/AB, IP/ER, etc. are real.
      for (const rateKey of ["AVG", "ERA", "WHIP"]) {
        delete stats[rateKey];
      }
      if (Object.keys(stats).length) {
        rows.push({ playerId: player.id, statDate: split.date, gamePk: split.game?.gamePk ?? null, split: "game", stats });
      }
    }
  }

  return rows;
}

export type SyncPlayerBiosResult = {
  ingestionRunId: string;
  rowsSeen: number;
  rowsWritten: number;
  status: "succeeded";
  source: string;
};

type MlbPerson = { id?: number; primaryNumber?: string };
type MlbPeopleResponse = { people?: MlbPerson[] };

/**
 * Fill in player bio detail (jersey number) from the MLB Stats API, batching
 * the /people endpoint so ~1,300 players resolve in a dozen requests.
 */
export async function syncPlayerBios(baseUrl = defaultBaseUrl): Promise<SyncPlayerBiosResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const ingestion = await client.query<{ id: string }>(
      `insert into ingestion_run (source, job_type, status) values ($1, 'player-bios', 'started') returning id`,
      [source],
    );
    const ingestionRunId = ingestion.rows[0].id;
    let rowsSeen = 0;
    let rowsWritten = 0;

    try {
      const players = await client.query<{ mlb_player_id: number }>(
        `select mlb_player_id from player where mlb_player_id is not null`,
      );
      const ids = players.rows.map((row) => row.mlb_player_id);
      const batchSize = 100;

      for (let index = 0; index < ids.length; index += batchSize) {
        const batch = ids.slice(index, index + batchSize);
        const payload = await fetchJson<MlbPeopleResponse>(`/people?personIds=${batch.join(",")}`, baseUrl);

        for (const person of payload.people ?? []) {
          rowsSeen += 1;
          if (person.id == null || !person.primaryNumber) {
            continue;
          }
          const result = await client.query(`update player set jersey_number = $1, updated_at = now() where mlb_player_id = $2`, [
            person.primaryNumber,
            person.id,
          ]);
          rowsWritten += result.rowCount ?? 0;
        }
      }

      await client.query(`update ingestion_run set status = 'succeeded', finished_at = now(), rows_seen = $1 where id = $2`, [
        rowsSeen,
        ingestionRunId,
      ]);

      return { ingestionRunId, rowsSeen, rowsWritten, status: "succeeded", source };
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
