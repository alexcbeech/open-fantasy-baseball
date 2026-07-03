"use client";

import { useEffect, useRef, useState } from "react";
import type { Player } from "@/lib/fantasy/types";

type PlayerWatchButtonProps = {
  players: Player[];
};

/**
 * Collapses the old always-on Player Watch side panel into a single button
 * badged with the number of watched players carrying news. Tapping it opens a
 * sheet with the headlines, so the lineup can use the full page width.
 */
export function PlayerWatchButton({ players }: PlayerWatchButtonProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const withNews = players.filter((player) => player.newsHeadline);
  const count = withNews.length;

  useEffect(() => {
    if (!open) {
      return;
    }
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        className="watch-button"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Player Watch, ${count} ${count === 1 ? "update" : "updates"}`}
      >
        Player Watch
        {count ? (
          <span className="watch-badge" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="sheet-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="move-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="watch-sheet-title"
            tabIndex={-1}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="move-sheet-grabber" aria-hidden="true" />
            <div className="move-sheet-header">
              <h2 id="watch-sheet-title">Player Watch</h2>
              <button className="move-sheet-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                &times;
              </button>
            </div>
            <div className="stat-list">
              {withNews.length ? (
                withNews.map((player) => (
                  <div className="setting-row" key={player.id}>
                    <div>
                      <div className="player-name">{player.name}</div>
                      <div className="player-meta">{player.newsHeadline}</div>
                    </div>
                    <span className="pill">{player.status}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state">No player news right now.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
