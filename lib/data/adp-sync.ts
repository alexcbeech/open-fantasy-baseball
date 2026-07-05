import { getPool } from "../db/client";

export type AdpEntry = {
  espnPlayerId: number | null;
  fullName: string;
  adp: number;
};

/**
 * An ADP provider returns the draft-market average draft position for the
 * player universe. The default implementation reads ESPN's public fantasy
 * API; a derived ranking fills in whenever the external feed is unavailable,
 * so drafting never depends on the feed being up.
 */
export interface AdpProvider {
  readonly source: string;
  fetchAdp(seasonYear: number): Promise<AdpEntry[]>;
}

const ESPN_ADP_URL = (seasonYear: number) =>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/${seasonYear}/segments/0/leaguedefaults/1?view=kona_player_info`;

// ESPN caps responses by this filter header; 700 covers every draftable player.
const ESPN_FANTASY_FILTER = JSON.stringify({
  players: { limit: 700, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" } },
});

type EspnPlayerEntry = {
  player?: {
    id?: number;
    fullName?: string;
    ownership?: { averageDraftPosition?: number };
  };
};

export class EspnAdpProvider implements AdpProvider {
  readonly source = "espn-fantasy";

  async fetchAdp(seasonYear: number): Promise<AdpEntry[]> {
    const response = await fetch(ESPN_ADP_URL(seasonYear), {
      headers: { "X-Fantasy-Filter": ESPN_FANTASY_FILTER, accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ESPN ADP request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as { players?: EspnPlayerEntry[] };
    const entries: AdpEntry[] = [];

    for (const entry of payload.players ?? []) {
      const adp = entry.player?.ownership?.averageDraftPosition;

      if (!entry.player?.fullName || typeof adp !== "number" || adp <= 0) {
        continue;
      }

      entries.push({
        espnPlayerId: entry.player.id ?? null,
        fullName: entry.player.fullName,
        adp,
      });
    }

    if (!entries.length) {
      throw new Error("ESPN ADP response contained no usable players.");
    }

    return entries;
  }
}

// The smartfantasybaseball player id map is the free ESPN<->MLBAM crosswalk
// (the Chadwick register does not carry ESPN ids). Name matching backstops
// players missing from the map.
const PLAYER_ID_MAP_URL = "https://www.smartfantasybaseball.com/PLAYERIDMAPCSV";

let idMapCache: Map<number, number> | null = null;

/** espn id -> mlbam id, cached for the process lifetime. */
export async function loadEspnToMlbamMap(fetchImpl: typeof fetch = fetch): Promise<Map<number, number>> {
  if (idMapCache) {
    return idMapCache;
  }

  const response = await fetchImpl(PLAYER_ID_MAP_URL, { headers: { accept: "text/csv" } });

  if (!response.ok) {
    throw new Error(`Player id map request failed with status ${response.status}.`);
  }

  idMapCache = parseEspnToMlbamCsv(await response.text());
  return idMapCache;
}

/** Parses the PLAYERIDMAP CSV into espn->mlbam. Exported for tests. */
export function parseEspnToMlbamCsv(csv: string): Map<number, number> {
  const lines = csv.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "");
  const mlbIndex = header.indexOf("MLBID");
  const espnIndex = header.indexOf("ESPNID");
  const map = new Map<number, number>();

  if (mlbIndex === -1 || espnIndex === -1) {
    return map;
  }

  for (const line of lines.slice(1)) {
    if (!line) {
      continue;
    }

    const cells = splitCsvLine(line);
    const mlbId = Number.parseInt(cells[mlbIndex] ?? "", 10);
    const espnId = Number.parseInt(cells[espnIndex] ?? "", 10);

    if (Number.isFinite(mlbId) && Number.isFinite(espnId)) {
      map.set(espnId, mlbId);
    }
  }

  return map;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

/** Accent-insensitive, suffix-insensitive name key for the fallback match. */
export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type KnownPlayer = {
  id: string;
  mlbPlayerId: number | null;
  fullName: string;
};

export type MatchedAdp = {
  playerId: string;
  adp: number;
  adpRank: number;
  espnPlayerId: number | null;
};

/**
 * Matches external ADP entries to OFB players: ESPN id -> MLBAM id via the
 * crosswalk first, normalized full-name second. Ranks are assigned by
 * ascending ADP after matching so player_adp always carries a dense 1..N.
 * Pure so the matching behavior is unit-testable.
 */
export function matchAdpToPlayers(
  entries: AdpEntry[],
  players: KnownPlayer[],
  espnToMlbam: Map<number, number>,
): MatchedAdp[] {
  const byMlbamId = new Map<number, KnownPlayer>();
  const byName = new Map<string, KnownPlayer>();

  for (const player of players) {
    if (player.mlbPlayerId !== null) {
      byMlbamId.set(player.mlbPlayerId, player);
    }

    // First name in wins on collisions; ids are the trustworthy path.
    const key = normalizePlayerName(player.fullName);

    if (!byName.has(key)) {
      byName.set(key, player);
    }
  }

  const matched: MatchedAdp[] = [];
  const seen = new Set<string>();

  for (const entry of [...entries].sort((left, right) => left.adp - right.adp)) {
    const mlbamId = entry.espnPlayerId !== null ? espnToMlbamId(espnToMlbam, entry.espnPlayerId) : null;
    const player =
      (mlbamId !== null ? byMlbamId.get(mlbamId) : undefined) ?? byName.get(normalizePlayerName(entry.fullName));

    if (!player || seen.has(player.id)) {
      continue;
    }

    seen.add(player.id);
    matched.push({
      playerId: player.id,
      adp: entry.adp,
      adpRank: matched.length + 1,
      espnPlayerId: entry.espnPlayerId,
    });
  }

  return matched;
}

function espnToMlbamId(map: Map<number, number>, espnId: number): number | null {
  return map.get(espnId) ?? null;
}

export type SyncAdpResult = {
  ingestionRunId: string;
  source: string;
  entriesSeen: number;
  playersMatched: number;
  status: "succeeded";
};

/**
 * Syncs external ADP into player_adp with ingestion_run attribution. Tries
 * the ESPN feed first; any failure falls back to a ranking derived from the
 * players' own season fan points, so the draft board is never empty.
 */
export async function syncAdp(
  options: { provider?: AdpProvider; seasonYear?: number; fetchImpl?: typeof fetch } = {},
): Promise<SyncAdpResult> {
  const pool = getPool();
  const client = await pool.connect();
  const seasonYear = options.seasonYear ?? new Date().getFullYear();

  try {
    const players = await client.query<{ id: string; mlb_player_id: number | null; full_name: string }>(
      `select id, mlb_player_id, full_name from player`,
    );
    const known: KnownPlayer[] = players.rows.map((row) => ({
      id: row.id,
      mlbPlayerId: row.mlb_player_id,
      fullName: row.full_name,
    }));

    let source: string;
    let matched: MatchedAdp[];
    let entriesSeen = 0;

    try {
      const provider = options.provider ?? new EspnAdpProvider();
      const entries = await provider.fetchAdp(seasonYear);
      const idMap = await loadEspnToMlbamMap(options.fetchImpl ?? fetch).catch(() => new Map<number, number>());
      entriesSeen = entries.length;
      matched = matchAdpToPlayers(entries, known, idMap);
      source = provider.source;

      if (!matched.length) {
        throw new Error("No external ADP entries matched known players.");
      }
    } catch (error) {
      console.warn("External ADP unavailable; deriving ranks from season fan points.", error);
      const derived = await client.query<{ id: string }>(
        `select p.id
         from player p
         left join lateral (
           select stats from player_stat_line psl
           where psl.player_id = p.id and split = 'projection_ros'
           order by stat_date desc limit 1
         ) proj on true
         order by p.season_fan_points desc nulls last, p.full_name`,
      );
      entriesSeen = derived.rows.length;
      matched = derived.rows.map((row, index) => ({
        playerId: row.id,
        adp: index + 1,
        adpRank: index + 1,
        espnPlayerId: null,
      }));
      source = "ofb-derived";
    }

    const ingestion = await client.query<{ id: string }>(
      `insert into ingestion_run (source, job_type, status)
       values ($1, 'adp', 'started')
       returning id`,
      [source],
    );
    const ingestionRunId = ingestion.rows[0].id;

    try {
      await client.query("begin");
      // Replace wholesale so ranks stay dense after players fall out of the feed.
      await client.query(`delete from player_adp`);

      for (const row of matched) {
        await client.query(
          `insert into player_adp (player_id, adp, adp_rank, source, espn_player_id)
           values ($1, $2, $3, $4, $5)`,
          [row.playerId, row.adp, row.adpRank, source, row.espnPlayerId],
        );
      }

      await client.query(
        `update ingestion_run set status = 'succeeded', finished_at = now(), rows_seen = $1 where id = $2`,
        [entriesSeen, ingestionRunId],
      );
      await client.query("commit");

      return { ingestionRunId, source, entriesSeen, playersMatched: matched.length, status: "succeeded" };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      await client.query(
        `update ingestion_run set status = 'failed', finished_at = now(), rows_seen = $1, error_message = $2 where id = $3`,
        [entriesSeen, error instanceof Error ? error.message : String(error), ingestionRunId],
      );
      throw error;
    }
  } finally {
    client.release();
  }
}
