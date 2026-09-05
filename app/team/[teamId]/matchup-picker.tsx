"use client";

import { useId, useState, type ReactNode } from "react";

export function MatchupPicker({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div>
      <button
        className="secondary-button"
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        All Matchups ({count}) <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      <div id={contentId} hidden={!open} className="matchup-picker-content">
        {children}
      </div>
    </div>
  );
}
