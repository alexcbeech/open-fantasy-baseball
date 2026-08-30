"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatScoringType } from "@/lib/fantasy/scoring";
import type { LeagueAnnouncement, LeagueMilestones, LeagueScoringType, LeagueSettings } from "@/lib/fantasy/types";

type LeagueHubProps = {
  leagueId: string;
  leagueName: string;
  seasonYear: number;
  commissionerName: string;
  scoringType: LeagueScoringType;
  settings: LeagueSettings;
  milestones: LeagueMilestones;
  announcements: LeagueAnnouncement[];
  canManage: boolean;
};

function formatDate(value: string | null, includeTime = false) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat(
    undefined,
    includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium", timeZone: "America/New_York" },
  ).format(new Date(value));
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function tradeReviewLabel(settings: LeagueSettings) {
  if (settings.tradeReview === "none") {
    return "No review";
  }

  const reviewer = settings.tradeReview === "league-vote" ? "League vote" : "Commissioner";
  return `${reviewer} · ${settings.tradeReviewDays} day${settings.tradeReviewDays === 1 ? "" : "s"}`;
}

function DateCard({ label, value, detail, includeTime = false }: { label: string; value: string | null; detail: string; includeTime?: boolean }) {
  return (
    <div className="league-date-card">
      <span>{label}</span>
      <strong>
        <time dateTime={value ?? undefined} suppressHydrationWarning>
          {formatDate(value, includeTime)}
        </time>
      </strong>
      <small>{detail}</small>
    </div>
  );
}

export function LeagueHub({
  leagueId,
  leagueName,
  seasonYear,
  commissionerName,
  scoringType,
  settings,
  milestones,
  announcements,
  canManage,
}: LeagueHubProps) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState(() => toLocalDateTimeInput(milestones.tradeDeadlineAt));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "good" | "bad"; text: string } | null>(null);

  async function request(url: string, init: RequestInit, success: string) {
    setMessage(null);

    try {
      const response = await fetch(url, init);
      const result = response.status === 204 ? {} : ((await response.json()) as { error?: string });

      if (!response.ok) {
        setMessage({ kind: "bad", text: result.error ?? "League information could not be updated." });
        return false;
      }

      setMessage({ kind: "good", text: success });
      router.refresh();
      return true;
    } catch {
      setMessage({ kind: "bad", text: "League information could not be updated." });
      return false;
    }
  }

  async function saveDeadline() {
    setBusy("deadline");
    const parsedDeadline = deadlineInput ? new Date(deadlineInput) : null;

    if (parsedDeadline && Number.isNaN(parsedDeadline.getTime())) {
      setMessage({ kind: "bad", text: "Enter a valid trade deadline." });
      setBusy(null);
      return;
    }

    await request(
      `/api/v1/leagues/${leagueId}/info`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tradeDeadlineAt: parsedDeadline?.toISOString() ?? null }),
      },
      deadlineInput ? "Trade deadline saved." : "Trade deadline cleared.",
    );
    setBusy(null);
  }

  async function publishAnnouncement() {
    setBusy("publish");
    const created = await request(
      `/api/v1/leagues/${leagueId}/announcements`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, isPinned }),
      },
      "Announcement published.",
    );

    if (created) {
      setTitle("");
      setBody("");
      setIsPinned(false);
    }

    setBusy(null);
  }

  async function updateAnnouncement(announcement: LeagueAnnouncement, action: "pin" | "archive") {
    setBusy(`${action}:${announcement.id}`);
    await request(
      `/api/v1/leagues/${leagueId}/announcements/${announcement.id}`,
      action === "archive"
        ? { method: "DELETE" }
        : {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isPinned: !announcement.isPinned }),
          },
      action === "archive" ? "Announcement archived." : announcement.isPinned ? "Announcement unpinned." : "Announcement pinned.",
    );
    setBusy(null);
  }

  const pinned = announcements.find((announcement) => announcement.isPinned) ?? null;
  const recent = announcements.filter((announcement) => announcement.id !== pinned?.id);
  const playoffDetail = scoringType === "roto" ? "Season-long standings" : `${settings.playoffTeamCount} teams qualify`;

  return (
    <section className="panel league-hub" aria-labelledby="league-hub-heading">
      <header className="league-hub-header">
        <div>
          <span className="league-hub-kicker">{seasonYear} League Hub</span>
          <h2 id="league-hub-heading">{leagueName}</h2>
          <p>Announcements, key dates, and the rules everyone plays by.</p>
        </div>
        {canManage ? (
          <button className="secondary-button" type="button" onClick={() => setManageOpen((open) => !open)}>
            {manageOpen ? "Close tools" : "Manage league info"}
          </button>
        ) : null}
      </header>

      {pinned ? (
        <article className="league-announcement featured">
          <div className="league-announcement-heading">
            <span className="pill">Pinned announcement</span>
            <time dateTime={pinned.publishedAt} suppressHydrationWarning>
              {formatDate(pinned.publishedAt)}
            </time>
          </div>
          <h3>{pinned.title}</h3>
          <p>{pinned.body}</p>
          <small>Posted by {pinned.authorName}</small>
        </article>
      ) : (
        <div className="league-announcement-empty">No commissioner announcements yet.</div>
      )}

      <div className="league-date-grid" aria-label="League key dates">
        <DateCard label="Trade deadline" value={milestones.tradeDeadlineAt} detail="New offers and acceptances close" includeTime />
        <DateCard label="Regular season ends" value={milestones.regularSeasonEndsAt} detail="Final standings set the field" />
        <DateCard label="Playoffs start" value={milestones.playoffsStartAt} detail={playoffDetail} />
        <DateCard label="Championship" value={milestones.championshipStartsAt} detail="Final scoring period begins" />
        {milestones.draftAt ? <DateCard label="Draft" value={milestones.draftAt} detail="League draft start" includeTime /> : null}
      </div>

      <div className="league-basics" aria-label="League rules summary">
        <div>
          <span>Commissioner</span>
          <strong>{commissionerName}</strong>
        </div>
        <div>
          <span>Scoring</span>
          <strong>{formatScoringType(scoringType)}</strong>
        </div>
        <div>
          <span>Waivers</span>
          <strong>{settings.waiverMode === "faab" ? `$${settings.faabBudget} FAAB` : "Rolling priority"}</strong>
        </div>
        <div>
          <span>Trade review</span>
          <strong>{tradeReviewLabel(settings)}</strong>
        </div>
      </div>

      {recent.length ? (
        <details className="league-announcement-history">
          <summary>Recent announcements ({recent.length})</summary>
          <div className="league-announcement-list">
            {recent.map((announcement) => (
              <article className="league-announcement" key={announcement.id}>
                <div className="league-announcement-heading">
                  <h3>{announcement.title}</h3>
                  <time dateTime={announcement.publishedAt} suppressHydrationWarning>
                    {formatDate(announcement.publishedAt)}
                  </time>
                </div>
                <p>{announcement.body}</p>
                <small>Posted by {announcement.authorName}</small>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      {canManage && manageOpen ? (
        <div className="league-hub-tools">
          <h3>Commissioner tools</h3>
          {message ? <div className={`status-banner ${message.kind}`}>{message.text}</div> : null}

          <div className="league-deadline-editor">
            <label className="settings-field">
              Trade deadline
              <input
                type="datetime-local"
                value={deadlineInput}
                suppressHydrationWarning
                onChange={(event) => setDeadlineInput(event.target.value)}
              />
            </label>
            <button className="secondary-button" type="button" disabled={busy !== null} aria-busy={busy === "deadline"} onClick={saveDeadline}>
              Save deadline
            </button>
          </div>

          <div className="league-announcement-editor">
            <label className="settings-field">
              Announcement title
              <input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="settings-field">
              Message
              <textarea maxLength={2000} rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
              Pin as the primary announcement
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={busy !== null || !title.trim() || !body.trim()}
              aria-busy={busy === "publish"}
              onClick={publishAnnouncement}
            >
              Publish announcement
            </button>
          </div>

          {announcements.length ? (
            <div className="league-announcement-manage-list">
              {announcements.map((announcement) => (
                <div className="league-announcement-manage-row" key={announcement.id}>
                  <div>
                    <strong>{announcement.title}</strong>
                    <span>{announcement.isPinned ? "Pinned" : "Recent"}</span>
                  </div>
                  <div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy !== null}
                      aria-busy={busy === `pin:${announcement.id}`}
                      onClick={() => updateAnnouncement(announcement, "pin")}
                    >
                      {announcement.isPinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy !== null}
                      aria-busy={busy === `archive:${announcement.id}`}
                      onClick={() => updateAnnouncement(announcement, "archive")}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
