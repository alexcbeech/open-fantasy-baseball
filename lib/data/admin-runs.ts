import { isDatabaseConfigured, query, tryDatabase } from "@/lib/db/client";
import { listRecentJobs, type JobRow } from "@/lib/jobs/queue";

export type IngestionRunSummary = {
  id: string;
  source: string;
  jobType: string;
  status: "started" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  rowsSeen: number;
  errorMessage: string | null;
};

export type BackgroundJobRunSummary = {
  id: string;
  jobName: string;
  status: "started" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  details: Record<string, unknown>;
};

export type AdminRunHistory = {
  databaseConfigured: boolean;
  freshness: AdminDataFreshness;
  ingestionRuns: IngestionRunSummary[];
  backgroundJobRuns: BackgroundJobRunSummary[];
  jobQueue: JobRow[];
};

export type AdminDataFreshness = {
  status: "ok" | "stale" | "missing";
  lastSuccessfulMlbSyncAt: string | null;
  playerCount: number;
  mlbTeamCount: number;
  positionEligibilityCount: number;
  scheduledGameCount: number;
  probableStarterCount: number;
  playerNewsCount: number;
  statLineCount: number;
};

type IngestionRunRow = {
  id: string;
  source: string;
  job_type: string;
  status: IngestionRunSummary["status"];
  started_at: Date | string;
  finished_at: Date | string | null;
  rows_seen: number;
  error_message: string | null;
};

type BackgroundJobRunRow = {
  id: string;
  job_name: string;
  status: BackgroundJobRunSummary["status"];
  started_at: Date | string;
  finished_at: Date | string | null;
  details: Record<string, unknown>;
};

type CountRow = {
  count: string | number;
};

type LatestMlbSyncRow = {
  finished_at: Date | string | null;
};

const emptyFreshness: AdminDataFreshness = {
  status: "missing",
  lastSuccessfulMlbSyncAt: null,
  playerCount: 0,
  mlbTeamCount: 0,
  positionEligibilityCount: 0,
  scheduledGameCount: 0,
  probableStarterCount: 0,
  playerNewsCount: 0,
  statLineCount: 0,
};

export async function listAdminRunHistory(limit = 6): Promise<AdminRunHistory> {
  return tryDatabase(
    async () => {
      const [
        ingestionResult,
        backgroundResult,
        latestMlbSyncResult,
        playerCountResult,
        teamCountResult,
        positionCountResult,
        gameCountResult,
        probableStarterCountResult,
        newsCountResult,
        statLineCountResult,
      ] = await Promise.all([
        query<IngestionRunRow>(
          `select id, source, job_type, status, started_at, finished_at, rows_seen, error_message
           from ingestion_run
           order by started_at desc
           limit $1`,
          [limit],
        ),
        query<BackgroundJobRunRow>(
          `select id, job_name, status, started_at, finished_at, details
           from background_job_run
           order by started_at desc
           limit $1`,
          [limit],
        ),
        query<LatestMlbSyncRow>(
          `select finished_at
           from ingestion_run
           where source = 'mlb-stats-api'
             and job_type = 'teams-rosters'
             and status = 'succeeded'
           order by finished_at desc nulls last, started_at desc
           limit 1`,
        ),
        query<CountRow>("select count(*) as count from player"),
        query<CountRow>("select count(*) as count from mlb_team"),
        query<CountRow>("select count(*) as count from player_position_eligibility where valid_to is null"),
        query<CountRow>("select count(*) as count from mlb_game"),
        query<CountRow>(
          `select count(*) as count
           from mlb_game
           where home_probable_pitcher_player_id is not null
              or away_probable_pitcher_player_id is not null`,
        ),
        query<CountRow>("select count(*) as count from player_news"),
        query<CountRow>("select count(*) as count from player_stat_line"),
      ]);
      const jobQueue = await listRecentJobs(limit);
      const latestMlbSyncAt = latestMlbSyncResult.rows[0]?.finished_at
        ? toIsoString(latestMlbSyncResult.rows[0].finished_at)
        : null;

      return {
        databaseConfigured: isDatabaseConfigured(),
        freshness: {
          status: getFreshnessStatus(latestMlbSyncAt),
          lastSuccessfulMlbSyncAt: latestMlbSyncAt,
          playerCount: readCount(playerCountResult.rows[0]),
          mlbTeamCount: readCount(teamCountResult.rows[0]),
          positionEligibilityCount: readCount(positionCountResult.rows[0]),
          scheduledGameCount: readCount(gameCountResult.rows[0]),
          probableStarterCount: readCount(probableStarterCountResult.rows[0]),
          playerNewsCount: readCount(newsCountResult.rows[0]),
          statLineCount: readCount(statLineCountResult.rows[0]),
        },
        ingestionRuns: ingestionResult.rows.map(mapIngestionRun),
        backgroundJobRuns: backgroundResult.rows.map(mapBackgroundJobRun),
        jobQueue,
      };
    },
    () => ({
      databaseConfigured: isDatabaseConfigured(),
      freshness: emptyFreshness,
      ingestionRuns: [],
      backgroundJobRuns: [],
      jobQueue: [],
    }),
  );
}

export function getFreshnessStatus(lastSuccessfulMlbSyncAt: string | null, now = new Date()) {
  if (!lastSuccessfulMlbSyncAt) {
    return "missing" as const;
  }

  const lastSync = new Date(lastSuccessfulMlbSyncAt);
  const ageMs = now.getTime() - lastSync.getTime();
  const staleAfterMs = 36 * 60 * 60 * 1000;

  return Number.isFinite(ageMs) && ageMs <= staleAfterMs ? ("ok" as const) : ("stale" as const);
}

function mapIngestionRun(row: IngestionRunRow): IngestionRunSummary {
  return {
    id: row.id,
    source: row.source,
    jobType: row.job_type,
    status: row.status,
    startedAt: toIsoString(row.started_at),
    finishedAt: row.finished_at ? toIsoString(row.finished_at) : null,
    rowsSeen: row.rows_seen,
    errorMessage: row.error_message,
  };
}

function mapBackgroundJobRun(row: BackgroundJobRunRow): BackgroundJobRunSummary {
  return {
    id: row.id,
    jobName: row.job_name,
    status: row.status,
    startedAt: toIsoString(row.started_at),
    finishedAt: row.finished_at ? toIsoString(row.finished_at) : null,
    details: row.details ?? {},
  };
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function readCount(row: CountRow | undefined) {
  if (!row) {
    return 0;
  }

  return typeof row.count === "number" ? row.count : Number.parseInt(row.count, 10);
}
