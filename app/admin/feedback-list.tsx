"use client";

import { useMemo, useState } from "react";
import { feedbackStatuses, type FeedbackRecord, type FeedbackStatus } from "@/lib/data/feedback-schema";

const statusLabels: Record<FeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  closed: "Closed",
};

type Filter = "all" | FeedbackStatus;
const filterOrder: Filter[] = ["all", "new", "reviewed", "closed"];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AdminFeedbackList({ initialFeedback }: { initialFeedback: FeedbackRecord[] }) {
  const [items, setItems] = useState(initialFeedback);
  const [filter, setFilter] = useState<Filter>("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPromotingAll, setIsPromotingAll] = useState(false);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    const base: Record<Filter, number> = { all: items.length, new: 0, reviewed: 0, closed: 0 };
    for (const item of items) {
      base[item.status] += 1;
    }
    return base;
  }, [items]);

  // The New tab is a triage queue, so it reads oldest-first; other views stay newest-first.
  const visible = useMemo(() => {
    if (filter === "all") {
      return items;
    }
    const filtered = items.filter((item) => item.status === filter);
    return filter === "new" ? filtered.slice().reverse() : filtered;
  }, [items, filter]);

  const promotable = filter === "new" ? visible.filter((item) => !item.githubIssueUrl) : [];

  async function setStatus(id: string, status: FeedbackStatus) {
    const previous = items;
    setSavingId(id);
    setError("");
    // Optimistic: reflect the change immediately, roll back if the request fails.
    setItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));

    try {
      const response = await fetch(`/api/v1/feedback/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        setError(result.error ?? "Status could not be updated.");
        setItems(previous);
      }
    } catch {
      setError("Status could not be updated. Check your connection and try again.");
      setItems(previous);
    } finally {
      setSavingId(null);
    }
  }

  async function promote(id: string) {
    setPromotingId(id);
    setError("");

    try {
      const response = await fetch(`/api/v1/feedback/${id}/promote`, { method: "POST" });
      const result = (await response.json().catch(() => ({}))) as { error?: string; feedback?: FeedbackRecord };

      if (!response.ok || !result.feedback) {
        setError(result.error ?? "GitHub issue could not be created.");
        return;
      }

      const updated = result.feedback;
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch {
      setError("GitHub issue could not be created. Check your connection and try again.");
    } finally {
      setPromotingId(null);
    }
  }

  async function refresh() {
    setIsRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/v1/feedback");
      const result = (await response.json().catch(() => ({}))) as { error?: string; feedback?: FeedbackRecord[] };

      if (!response.ok || !result.feedback) {
        setError(result.error ?? "Feedback could not be refreshed.");
        return;
      }

      setItems(result.feedback);
    } catch {
      setError("Feedback could not be refreshed. Check your connection and try again.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function promoteAll() {
    setIsPromotingAll(true);
    setError("");
    let failures = 0;

    // Sequential on purpose: each promote hits the GitHub API, and parallel
    // bursts are what its secondary rate limits punish.
    for (const item of promotable) {
      setPromotingId(item.id);

      try {
        const response = await fetch(`/api/v1/feedback/${item.id}/promote`, { method: "POST" });
        const result = (await response.json().catch(() => ({}))) as { feedback?: FeedbackRecord };

        if (!response.ok || !result.feedback) {
          failures += 1;
          continue;
        }

        const updated = result.feedback;
        setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      } catch {
        failures += 1;
      }
    }

    if (failures) {
      setError(`${failures} of ${promotable.length} feedback item${promotable.length === 1 ? "" : "s"} could not be promoted.`);
    }

    setPromotingId(null);
    setIsPromotingAll(false);
  }

  if (!items.length) {
    return (
      <>
        <div className="feedback-admin-toolbar">
          <button className="secondary-button" type="button" onClick={refresh} disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {error ? <div className="status-banner bad">{error}</div> : null}
        <div className="empty-state">No feedback yet</div>
      </>
    );
  }

  return (
    <>
      <div className="feedback-admin-toolbar">
        <div className="feedback-admin-filters" role="group" aria-label="Filter feedback by status">
          {filterOrder.map((key) => (
            <button
              key={key}
              type="button"
              className="feedback-filter"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {key === "all" ? "All" : statusLabels[key]}
              <span className="feedback-filter-count">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="feedback-admin-toolbar-actions">
          {filter === "new" && promotable.length ? (
            <button
              className="secondary-button"
              type="button"
              onClick={promoteAll}
              disabled={isPromotingAll}
            >
              {isPromotingAll ? "Promoting..." : `Promote all to issues (${promotable.length})`}
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={refresh} disabled={isRefreshing || isPromotingAll}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="status-banner bad">{error}</div> : null}

      {visible.length ? (
        <div className="feedback-admin-list">
          {visible.map((item) => (
            <div className={item.status === "closed" ? "feedback-admin-item is-closed" : "feedback-admin-item"} key={item.id}>
              <div className="feedback-admin-item-head">
                <span className={item.category === "issue" ? "pill loss" : "pill"}>
                  {item.category === "issue" ? "Issue" : "Idea"}
                </span>
                <span className="subtle">{formatTime(item.createdAt)}</span>
              </div>

              <p className="feedback-admin-message">{item.message}</p>

              <div className="feedback-admin-footer">
                <div className="feedback-admin-meta">
                  <span>{item.userEmail ?? "Anonymous"}</span>
                  {item.pagePath ? <span className="feedback-admin-path">{item.pagePath}</span> : null}
                </div>
                <div className="feedback-admin-actions">
                  {item.githubIssueUrl ? (
                    <a className="feedback-issue-link" href={item.githubIssueUrl} target="_blank" rel="noreferrer">
                      Issue #{item.githubIssueNumber} ↗
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="feedback-promote"
                      disabled={promotingId === item.id || isPromotingAll}
                      onClick={() => promote(item.id)}
                    >
                      {promotingId === item.id ? "Creating…" : "Promote to issue"}
                    </button>
                  )}
                  <div className="feedback-status-control" role="group" aria-label="Set status">
                    {feedbackStatuses.map((status) => (
                      <button
                        key={status}
                        type="button"
                        aria-pressed={item.status === status}
                        disabled={savingId === item.id}
                        onClick={() => setStatus(item.id, status)}
                      >
                        {statusLabels[status]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No {statusLabels[filter as FeedbackStatus].toLowerCase()} feedback</div>
      )}
    </>
  );
}
