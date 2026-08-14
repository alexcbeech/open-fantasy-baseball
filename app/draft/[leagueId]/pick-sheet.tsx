"use client";

import { useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import { PlayerAvatar } from "@/app/team/[teamId]/player-avatar";
import { PositionBadge } from "@/app/team/[teamId]/position-badge";
import type { DraftPlayer } from "@/lib/draft/types";
import { rowPoints, statusLabels } from "@/lib/fantasy/player-view";

type PickSheetProps = {
  player: DraftPlayer;
  pickLabel: string | null;
  canPick: boolean;
  disabledReason: string | null;
  busy: boolean;
  /** Queue controls are shown only when the viewer has a team; null hides them. */
  isQueued: boolean | null;
  onConfirm: () => void;
  onToggleQueue: () => void;
  onClose: () => void;
};

const hitterStatOrder = ["H", "AB", "R", "HR", "RBI", "SB", "AVG"];
const pitcherStatOrder = ["IP", "K", "ER", "W", "SV", "ERA", "WHIP", "BB", "HA"];

/** Stable, baseball-friendly stat ordering for compact draft summaries. */
export function draftStatLine(stats: Record<string, number | string>, limit = 7): string {
  const preferred = "IP" in stats || "ERA" in stats || "WHIP" in stats ? pitcherStatOrder : hitterStatOrder;
  const keys = [...preferred.filter((key) => key in stats), ...Object.keys(stats).filter((key) => !preferred.includes(key))];

  return keys
    .slice(0, limit)
    .map((key) => `${stats[key]} ${key}`)
    .join(" · ");
}

/** Bottom-sheet pick confirmation: player summary, health, key stats, draft + queue. */
export function PickSheet({ player, pickLabel, canPick, disabledReason, busy, isQueued, onConfirm, onToggleQueue, onClose }: PickSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock();

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const { seasonPts, projPts } = rowPoints(player);
  const seasonLine = draftStatLine(player.seasonStats);
  const recentLine = draftStatLine(player.recentStats);
  const projectionLine = draftStatLine(player.projectedStats);
  const healthClass =
    player.status === "day-to-day"
      ? "health-dtd"
      : player.status === "injured"
        ? "health-injured"
        : player.status === "minors"
          ? "health-minors"
          : "health-active";

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pick-sheet-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet-grabber" aria-hidden="true" />
        <div className="move-sheet-header">
          <h2 id="pick-sheet-title">Draft Player</h2>
          <button className="move-sheet-close" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="pick-sheet-player">
          <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
          <span className="player-main">
            <span className="player-name">{player.name}</span>
            <span className="player-meta">
              {player.mlbTeam} &ndash; {player.positions.join(", ")}
            </span>
          </span>
          <span className="pick-sheet-badges">
            <span className={`health-badge ${healthClass}`}>{statusLabels[player.status]}</span>
            <PositionBadge slot={player.positions[0]} />
          </span>
        </div>

        {player.status !== "active" && player.newsHeadline ? (
          <div className="draft-health-note" role="status">
            {player.newsHeadline}
          </div>
        ) : null}

        <div className="pick-sheet-stats">
          <div className="metric">
            <span className="metric-label">ADP</span>
            <strong className="metric-value">{player.adp !== null ? player.adp.toFixed(1) : "—"}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">ADP Rank</span>
            <strong className="metric-value">{player.adpRank ?? "—"}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">Season Pts</span>
            <strong className="metric-value">{seasonPts}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">Proj Pts</span>
            <strong className="metric-value">{projPts}</strong>
          </div>
        </div>
        <div className="pick-sheet-stat-groups">
          <StatGroup label="Season" line={seasonLine} />
          <StatGroup label={player.recentGameDate ? `Last game · ${player.recentGameDate}` : "Last game"} line={recentLine} />
          <StatGroup label="Rest-of-season projection" line={projectionLine} />
        </div>

        <button className="primary-button" type="button" disabled={!canPick || busy} aria-busy={busy} onClick={onConfirm}>
          {busy ? "Drafting..." : pickLabel ? `Draft with pick ${pickLabel}` : "Draft"}
        </button>
        {isQueued !== null ? (
          <button className="secondary-button" type="button" onClick={onToggleQueue}>
            {isQueued ? "Remove from queue" : "Add to queue"}
          </button>
        ) : null}
        {!canPick && disabledReason ? <p className="player-meta pick-sheet-reason">{disabledReason}</p> : null}
      </div>
    </div>
  );
}

function StatGroup({ label, line }: { label: string; line: string }) {
  return (
    <div className="pick-sheet-stat-group">
      <span className="metric-label">{label}</span>
      <p className="player-meta pick-sheet-statline">{line || "Not available yet"}</p>
    </div>
  );
}
