"use client";

import { useState } from "react";
import type { AuditEventRecord } from "@/lib/data/audit-schema";

const PAGE_SIZE = 50;

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

/** Compact single-line rendering of the detail payload; empty details render nothing. */
function formatDetail(detail: Record<string, unknown>): string | null {
  const entries = Object.entries(detail);

  if (!entries.length) {
    return null;
  }

  return entries.map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`).join("  ");
}

export function AdminAuditLog({ initialEvents }: { initialEvents: AuditEventRecord[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // The last page is full until a fetch comes back short.
  const [maybeMore, setMaybeMore] = useState(initialEvents.length >= PAGE_SIZE);
  const [error, setError] = useState("");

  function queryString(before?: string) {
    const params = new URLSearchParams();

    if (actionFilter.trim()) {
      params.set("action", actionFilter.trim());
    }

    if (actorFilter.trim()) {
      params.set("actor", actorFilter.trim());
    }

    if (before) {
      params.set("before", before);
    }

    params.set("limit", String(PAGE_SIZE));
    return params.toString();
  }

  async function fetchEvents(before?: string): Promise<AuditEventRecord[] | null> {
    setError("");

    try {
      const response = await fetch(`/api/v1/admin/audit?${queryString(before)}`);
      const result = (await response.json().catch(() => ({}))) as { error?: string; events?: AuditEventRecord[] };

      if (!response.ok || !result.events) {
        setError(result.error ?? "Audit events could not be loaded.");
        return null;
      }

      return result.events;
    } catch {
      setError("Audit events could not be loaded. Check your connection and try again.");
      return null;
    }
  }

  async function refresh(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsLoading(true);
    const fresh = await fetchEvents();

    if (fresh) {
      setEvents(fresh);
      setMaybeMore(fresh.length >= PAGE_SIZE);
    }

    setIsLoading(false);
  }

  async function loadMore() {
    const oldest = events[events.length - 1];

    if (!oldest) {
      return;
    }

    setIsLoadingMore(true);
    const older = await fetchEvents(oldest.occurredAt);

    if (older) {
      setEvents((current) => [...current, ...older]);
      setMaybeMore(older.length >= PAGE_SIZE);
    }

    setIsLoadingMore(false);
  }

  return (
    <>
      <form className="audit-filters" onSubmit={refresh}>
        <input
          placeholder="Action (e.g. player. or trade.accept)"
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
          aria-label="Filter by action"
        />
        <input
          placeholder="Actor email"
          value={actorFilter}
          onChange={(event) => setActorFilter(event.target.value)}
          aria-label="Filter by actor email"
        />
        <button className="secondary-button" type="submit" disabled={isLoading}>
          {isLoading ? "Loading..." : "Search"}
        </button>
      </form>

      {error ? <div className="status-banner bad">{error}</div> : null}

      {events.length ? (
        <div className="audit-list">
          {events.map((event) => (
            <div className="audit-row" key={event.id}>
              <div className="audit-row-head">
                <span className="audit-action">{event.action}</span>
                <span className="audit-actor">{event.actorEmail ?? event.actorUserId ?? "anonymous"}</span>
                <span className="subtle">{formatTime(event.occurredAt)}</span>
              </div>
              <div className="audit-row-meta">
                {event.entityType && event.entityId ? (
                  <span>
                    {event.entityType} {event.entityId.slice(0, 8)}
                  </span>
                ) : null}
                {event.leagueId ? <span>league {event.leagueId.slice(0, 8)}</span> : null}
                {event.teamId ? <span>team {event.teamId.slice(0, 8)}</span> : null}
                {event.ip ? <span>{event.ip}</span> : null}
              </div>
              {formatDetail(event.detail) ? <div className="audit-detail">{formatDetail(event.detail)}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No audit events{actionFilter || actorFilter ? " match these filters" : " yet"}</div>
      )}

      {events.length && maybeMore ? (
        <button className="secondary-button audit-load-more" type="button" disabled={isLoadingMore} onClick={loadMore}>
          {isLoadingMore ? "Loading..." : "Load older events"}
        </button>
      ) : null}
    </>
  );
}
