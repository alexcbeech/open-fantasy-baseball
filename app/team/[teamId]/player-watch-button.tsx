"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import type { PlayerWatchItem } from "@/lib/fantasy/types";

type PlayerWatchButtonProps = {
  items: PlayerWatchItem[];
};

/**
 * Collapses the old always-on Player Watch side panel into a single button
 * badged with the number of rostered players carrying news. Tapping it opens a
 * sheet with the headlines, so the lineup can use the full page width.
 */
export function PlayerWatchButton({ items }: PlayerWatchButtonProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);

  const count = items.length;

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
              {items.length ? (
                items.map((item) => (
                  <div className="setting-row" key={item.id}>
                    <div>
                      <div className="player-name">{item.name}</div>
                      <div className="player-meta">{item.headline}</div>
                    </div>
                    <span className="pill">{item.status}</span>
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
