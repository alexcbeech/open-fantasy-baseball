"use client";

import { useState } from "react";
import type { AdminRunHistory } from "@/lib/data/admin-runs";

type OperationKey = "mlb-sync" | "nightly";

type OperationState = {
  kind: "idle" | "running" | "success" | "error";
  message: string;
  details: Array<{ label: string; value: string | number }>;
};

type ApiResponse = {
  error?: string;
  history?: AdminRunHistory;
  source?: string;
  status?: string;
  rowsSeen?: number;
  scheduleRowsSeen?: number;
  ingestionRunId?: string;
  summary?: {
    jobRunId: string | null;
    leaguesSeen: number;
    waiverClaimsSeen: number;
    waiverClaimsWon: number;
    waiverClaimsLost: number;
    transactionsCreated: number;
  };
};

const initialOperationState: OperationState = {
  kind: "idle",
  message: "",
  details: [],
};

const operations = [
  {
    key: "mlb-sync" as const,
    title: "MLB Data Sync",
    description: "Refresh MLB teams, active rosters, 40-man rosters, player metadata, schedules, and probable starters.",
    endpoint: "/api/v1/admin/sync/mlb",
    action: "Run sync",
  },
  {
    key: "nightly" as const,
    title: "Nightly Processing",
    description: "Resolve due waiver claims, write transaction audit records, and update the background job run log.",
    endpoint: "/api/v1/admin/jobs/nightly",
    action: "Run nightly",
  },
];

export function AdminOperationsPanel({ initialHistory }: { initialHistory: AdminRunHistory }) {
  const [operationStates, setOperationStates] = useState<Record<OperationKey, OperationState>>({
    "mlb-sync": initialOperationState,
    nightly: initialOperationState,
  });
  const [history, setHistory] = useState(initialHistory);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);

  async function runOperation(operation: (typeof operations)[number]) {
    setOperationStates((current) => ({
      ...current,
      [operation.key]: {
        kind: "running",
        message: `${operation.title} is running...`,
        details: [],
      },
    }));

    try {
      const response = await fetch(operation.endpoint, { method: "POST" });
      const result = await readApiResponse(response);

      if (!response.ok) {
        setOperationStates((current) => ({
          ...current,
          [operation.key]: {
            kind: "error",
            message: result.error ?? `${operation.title} failed.`,
            details: [],
          },
        }));
        return;
      }

      setOperationStates((current) => ({
        ...current,
        [operation.key]: buildSuccessState(operation.key, result),
      }));
      await refreshHistory();
    } catch {
      setOperationStates((current) => ({
        ...current,
        [operation.key]: {
          kind: "error",
          message: `${operation.title} could not be started.`,
          details: [],
        },
      }));
    }
  }

  async function refreshHistory() {
    setIsRefreshingHistory(true);

    try {
      const response = await fetch("/api/v1/admin/runs");
      const result = await readApiResponse(response);

      if (response.ok && result.history) {
        setHistory(result.history);
      }
    } catch {
      // Keep the last-known history when the refresh fetch fails (offline).
    } finally {
      setIsRefreshingHistory(false);
    }
  }

  return (
    <section className="panel admin-operations-panel" aria-labelledby="operations-heading">
      <h1 id="operations-heading">Operations</h1>
      <div className="admin-operation-list">
        {operations.map((operation) => {
          const state = operationStates[operation.key];
          const isRunning = state.kind === "running";

          return (
            <div className="admin-operation" key={operation.key}>
              <div>
                <h2>{operation.title}</h2>
                <p className="subtle">{operation.description}</p>
              </div>

              {state.message ? (
                <div className={state.kind === "error" ? "status-banner bad" : "status-banner good"}>{state.message}</div>
              ) : null}

              {state.details.length ? (
                <div className="metric-grid">
                  {state.details.map((detail) => (
                    <div className="metric" key={detail.label}>
                      <span className="metric-label">{detail.label}</span>
                      <strong className="metric-value">{detail.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              <button className="primary-button" type="button" disabled={isRunning} onClick={() => runOperation(operation)}>
                {isRunning ? "Running..." : operation.action}
              </button>
            </div>
          );
        })}
      </div>
      <section className="admin-history" aria-labelledby="history-heading">
        <div>
          <h2>Data Freshness</h2>
          <div className="metric-grid">
            <div className="metric">
              <span className="metric-label">MLB Sync</span>
              <strong className="metric-value">{formatFreshnessStatus(history.freshness.status)}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Players</span>
              <strong className="metric-value">{history.freshness.playerCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">MLB Teams</span>
              <strong className="metric-value">{history.freshness.mlbTeamCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Games</span>
              <strong className="metric-value">{history.freshness.scheduledGameCount}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Probables</span>
              <strong className="metric-value">{history.freshness.probableStarterCount}</strong>
            </div>
          </div>
          <div className="admin-freshness-meta">
            <span className={`pill freshness-${history.freshness.status}`}>{history.freshness.status}</span>
            <span className="player-meta">
              Last successful MLB sync:{" "}
              {history.freshness.lastSuccessfulMlbSyncAt ? formatDateTime(history.freshness.lastSuccessfulMlbSyncAt) : "never"}
            </span>
          </div>
          <div className="admin-freshness-meta">
            <span className="player-meta">{history.freshness.positionEligibilityCount} active position eligibility rows</span>
            <span className="player-meta">{history.freshness.playerNewsCount} news rows</span>
            <span className="player-meta">{history.freshness.statLineCount} stat lines</span>
          </div>
        </div>

        <div className="section-title admin-history-title">
          <h2 id="history-heading">Recent Runs</h2>
          <button className="secondary-button" type="button" onClick={refreshHistory} disabled={isRefreshingHistory}>
            {isRefreshingHistory ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {!history.databaseConfigured ? (
          <div className="empty-state">Database is not configured, so run history is unavailable.</div>
        ) : null}

        <RunHistoryGroup
          emptyLabel="No MLB sync runs yet"
          rows={history.ingestionRuns.map((run) => ({
            id: run.id,
            title: `${run.source} ${run.jobType}`,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            meta: `${run.rowsSeen} rows seen${run.errorMessage ? ` - ${run.errorMessage}` : ""}`,
          }))}
        />
        <RunHistoryGroup
          emptyLabel="No nightly processing runs yet"
          rows={history.backgroundJobRuns.map((run) => ({
            id: run.id,
            title: run.jobName,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            meta: summarizeJobDetails(run.details),
          }))}
        />

        <div className="section-title admin-history-title">
          <h2>Job Queue</h2>
        </div>
        <RunHistoryGroup
          emptyLabel="No queued jobs yet"
          rows={history.jobQueue.map((job) => ({
            id: job.id,
            title: job.jobType,
            // Map the queue's richer states onto the three run-status pills.
            status: job.status === "succeeded" ? "succeeded" : job.status === "failed" || job.status === "dead" ? "failed" : "started",
            startedAt: job.createdAt,
            finishedAt: job.status === "queued" || job.status === "running" ? null : job.updatedAt,
            meta: `${job.status} · attempt ${job.attempts}/${job.maxAttempts}${job.lastError ? ` · ${job.lastError}` : ""}`,
          }))}
        />
      </section>
    </section>
  );
}

function RunHistoryGroup({
  emptyLabel,
  rows,
}: {
  emptyLabel: string;
  rows: Array<{
    id: string;
    title: string;
    status: "started" | "succeeded" | "failed";
    startedAt: string;
    finishedAt: string | null;
    meta: string;
  }>;
}) {
  if (!rows.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="admin-run-list">
      {rows.map((run) => (
        <div className="admin-run-row" key={run.id}>
          <span className={`pill run-status-${run.status}`}>{run.status}</span>
          <div>
            <div className="player-name">{run.title}</div>
            <div className="player-meta">
              {formatDateTime(run.startedAt)}
              {run.finishedAt ? ` - finished ${formatDateTime(run.finishedAt)}` : ""}
            </div>
            <div className="player-meta">{run.meta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as ApiResponse;
  } catch {
    return { error: text };
  }
}

function buildSuccessState(operation: OperationKey, result: ApiResponse): OperationState {
  if (operation === "mlb-sync") {
    return {
      kind: "success",
      message: "MLB data sync completed.",
      details: [
        { label: "Rows Seen", value: result.rowsSeen ?? 0 },
        { label: "Games", value: result.scheduleRowsSeen ?? 0 },
        { label: "Status", value: result.status ?? "complete" },
      ],
    };
  }

  return {
    kind: "success",
    message: "Nightly processing completed.",
    details: [
      { label: "Leagues", value: result.summary?.leaguesSeen ?? 0 },
      { label: "Claims", value: result.summary?.waiverClaimsSeen ?? 0 },
      { label: "Transactions", value: result.summary?.transactionsCreated ?? 0 },
    ],
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFreshnessStatus(status: AdminRunHistory["freshness"]["status"]) {
  if (status === "ok") {
    return "Current";
  }

  if (status === "stale") {
    return "Stale";
  }

  return "Missing";
}

function summarizeJobDetails(details: Record<string, unknown>) {
  const transactionsCreated = readNumber(details.transactionsCreated);
  const waiverClaimsSeen = readNumber(details.waiverClaimsSeen);

  if (transactionsCreated !== null || waiverClaimsSeen !== null) {
    return `${transactionsCreated ?? 0} transactions, ${waiverClaimsSeen ?? 0} waiver claims`;
  }

  const error = typeof details.error === "string" ? details.error : null;
  return error ?? "Job details recorded";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
