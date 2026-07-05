"use client";

import { useEffect, useRef } from "react";
import { PlayerAvatar } from "@/app/team/[teamId]/player-avatar";
import { PositionBadge } from "@/app/team/[teamId]/position-badge";
import { rowPoints } from "@/lib/fantasy/player-view";
import type { DraftPlayer } from "@/lib/draft/types";

type PickSheetProps = {
  player: DraftPlayer;
  pickLabel: string | null;
  canPick: boolean;
  disabledReason: string | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Bottom-sheet pick confirmation: player summary, key stats, draft button. */
export function PickSheet({ player, pickLabel, canPick, disabledReason, busy, onConfirm, onClose }: PickSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

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
  const statLine = Object.entries(player.seasonStats)
    .slice(0, 5)
    .map(([category, value]) => `${value} ${category}`)
    .join(" · ");

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
          <PositionBadge slot={player.positions[0]} />
        </div>

        <div className="pick-sheet-stats">
          <div className="metric">
            <span className="metric-label">ADP</span>
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
        {statLine ? <p className="player-meta pick-sheet-statline">{statLine}</p> : null}

        <button className="primary-button" type="button" disabled={!canPick || busy} onClick={onConfirm}>
          {busy ? "Drafting..." : pickLabel ? `Draft with pick ${pickLabel}` : "Draft"}
        </button>
        {!canPick && disabledReason ? <p className="player-meta pick-sheet-reason">{disabledReason}</p> : null}
      </div>
    </div>
  );
}
