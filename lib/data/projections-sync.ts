import { getPool } from "../db/client";

export type StatMap = Record<string, number | string>;

export type PlayerProjectionContext = {
  playerId: string;
  fullName: string;
  season: StatMap;
  recent: StatMap | null;
};

export type PlayerProjection = {
  playerId: string;
  stats: StatMap;
};

/**
 * A projections provider turns a player's known stat history into a
 * rest-of-season projection. The default implementation derives projections
 * from data OFB already ingests, but the interface lets a paid projections
 * feed (e.g. a third-party model) be dropped in later without touching the
 * ingestion plumbing.
 */
export interface ProjectionsProvider {
  readonly source: string;
  project(contexts: PlayerProjectionContext[]): Promise<PlayerProjection[]> | PlayerProjection[];
}

// Rate stats are averaged; every other key is treated as a counting stat and
// paced across the remainder of the season.
const RATE_STATS = new Set(["AVG", "OBP", "SLG", "OPS", "ERA", "WHIP", "K/9", "BB/9"]);
const SEASON_MONTHS = 6;

export type DerivationOptions = {
  // Fraction of the season still to play. Counting stats are paced against it.
  remainingFraction?: number;
  // How strongly the trailing-30-day window pulls the projection toward recent form.
  recentWeight?: number;
};

function toNumber(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundRate(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Blend a player's season pace with their trailing-30-day form into a
 * rest-of-season projection. Counting stats (HR, RBI, K, ...) are paced across
 * the games left to play; rate stats (AVG, ERA, ...) are a recency-weighted
 * average. Pure and deterministic so it can be unit tested directly.
 */
export function deriveRosProjection(season: StatMap, recent: StatMap | null, options: DerivationOptions = {}): StatMap {
  const remainingFraction = Math.min(Math.max(options.remainingFraction ?? 0.45, 0), 1);
  const recentWeight = Math.min(Math.max(options.recentWeight ?? 0.3, 0), 1);
  const remainingMonths = remainingFraction * SEASON_MONTHS;
  const keys = new Set<string>([...Object.keys(season), ...Object.keys(recent ?? {})]);
  const projection: StatMap = {};

  for (const key of keys) {
    const seasonValue = toNumber(season[key]);
    const hasRecent = recent != null && key in recent;
    const recentValue = toNumber(recent?.[key]);

    if (RATE_STATS.has(key)) {
      const recentRate = hasRecent && recentValue > 0 ? recentValue : seasonValue;
      projection[key] = roundRate(seasonValue * (1 - recentWeight) + recentRate * recentWeight);
      continue;
    }

    // Counting stat: pace the season total across the games left, then nudge
    // toward the trailing-30-day rate (~one month of production) extrapolated
    // over the remaining months.
    const seasonEstimate = seasonValue * remainingFraction;
    const recentEstimate = hasRecent ? recentValue * remainingMonths : seasonEstimate;
    projection[key] = Math.round(seasonEstimate * (1 - recentWeight) + recentEstimate * recentWeight);
  }

  return projection;
}

export class DerivedProjectionsProvider implements ProjectionsProvider {
  readonly source = "ofb-derived-model";

  constructor(private readonly options: DerivationOptions = {}) {}

  project(contexts: PlayerProjectionContext[]): PlayerProjection[] {
    return contexts.map((context) => ({
      playerId: context.playerId,
      stats: deriveRosProjection(context.season, context.recent, this.options),
    }));
  }
}

type StatLineRow = {
  player_id: string;
  full_name: string;
  split: string;
  stats: StatMap;
};

export type SyncProjectionsResult = {
  ingestionRunId: string;
  rowsSeen: number;
  rowsWritten: number;
  status: "succeeded";
  source: string;
};

/**
 * Recompute rest-of-season projections for every player with a season stat
 * line and persist them to player_stat_line, recording an ingestion_run row so
 * the admin freshness view and source attribution stay accurate.
 */
export async function syncProjections(
  provider: ProjectionsProvider = new DerivedProjectionsProvider(),
  today = new Date(),
): Promise<SyncProjectionsResult> {
  const pool = getPool();
  const client = await pool.connect();
  const ingestion = await client.query<{ id: string }>(
    `insert into ingestion_run (source, job_type, status)
     values ($1, 'projections', 'started')
     returning id`,
    [provider.source],
  );
  const ingestionRunId = ingestion.rows[0].id;
  const statDate = today.toISOString().slice(0, 10);
  let rowsSeen = 0;
  let rowsWritten = 0;

  try {
    const lines = await client.query<StatLineRow>(
      `select distinct on (psl.player_id, psl.split)
         psl.player_id, p.full_name, psl.split, psl.stats
       from player_stat_line psl
       join player p on p.id = psl.player_id
       where psl.split in ('season', 'last_30')
       order by psl.player_id, psl.split, psl.stat_date desc`,
    );

    const byPlayer = new Map<string, PlayerProjectionContext>();

    for (const row of lines.rows) {
      rowsSeen += 1;
      const existing = byPlayer.get(row.player_id) ?? {
        playerId: row.player_id,
        fullName: row.full_name,
        season: {},
        recent: null,
      };

      if (row.split === "season") {
        existing.season = row.stats;
      } else {
        existing.recent = row.stats;
      }

      byPlayer.set(row.player_id, existing);
    }

    const contexts = [...byPlayer.values()].filter((context) => Object.keys(context.season).length > 0);
    const projections = await provider.project(contexts);

    await client.query("begin");

    for (const projection of projections) {
      if (Object.keys(projection.stats).length === 0) {
        continue;
      }

      await client.query(
        `insert into player_stat_line (player_id, stat_date, split, stats, source)
         values ($1, $2, 'projection_ros', $3::jsonb, $4)
         on conflict (player_id, stat_date, split, source) do update set
           stats = excluded.stats,
           collected_at = now()`,
        [projection.playerId, statDate, JSON.stringify(projection.stats), provider.source],
      );
      rowsWritten += 1;
    }

    await client.query(
      `update ingestion_run set status = 'succeeded', finished_at = now(), rows_seen = $1 where id = $2`,
      [rowsSeen, ingestionRunId],
    );
    await client.query("commit");

    return { ingestionRunId, rowsSeen, rowsWritten, status: "succeeded", source: provider.source };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.query(
      `update ingestion_run set status = 'failed', finished_at = now(), rows_seen = $1, error_message = $2 where id = $3`,
      [rowsSeen, error instanceof Error ? error.message : String(error), ingestionRunId],
    );
    throw error;
  } finally {
    client.release();
  }
}
