"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { formatGameLine, rowPoints } from "@/lib/fantasy/player-view";
import type { LineupPlayer } from "@/lib/fantasy/types";
import { buildLineupGroups } from "./lineup-editor";
import { PlayerAvatar } from "./player-avatar";
import { PositionBadge } from "./position-badge";

type TeamLineupSheetProps = {
  teamId: string;
  teamName: string;
  onClose: () => void;
  /** When set, shows a Propose Trade button that hands off to the trade sheet. */
  onProposeTrade?: () => void;
};

/**
 * Read-only view of another team's current lineup, opened from the League
 * tab's standings. Reuses the lineup editor's slot grouping and row layout,
 * minus every editing affordance; the lineup GET is league-member gated.
 */
export function TeamLineupSheet({ teamId, teamName, onClose, onProposeTrade }: TeamLineupSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock();
  const [lineup, setLineup] = useState<LineupPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/teams/${teamId}/lineup`);
        const result = (await response.json()) as { lineup?: LineupPlayer[]; error?: string };

        if (!active) {
          return;
        }

        if (!response.ok || !result.lineup) {
          setError(result.error ?? "The lineup could not be loaded.");
          return;
        }

        setLineup(result.lineup);
      } catch {
        if (active) {
          setError("The lineup could not be loaded.");
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [teamId]);

  const groups = lineup ? buildLineupGroups(lineup, defaultRosterSlots) : [];

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-lineup-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet-grabber" aria-hidden="true" />
        <div className="move-sheet-header">
          <h2 id="team-lineup-title">{teamName}</h2>
          <button className="move-sheet-close" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <p className="move-sheet-subtitle">Current lineup</p>

        {onProposeTrade ? (
          <button className="secondary-button" type="button" onClick={onProposeTrade}>
            Propose Trade
          </button>
        ) : null}

        {error ? <div className="empty-state">{error}</div> : null}
        {!error && !lineup ? <div className="empty-state">Loading lineup&hellip;</div> : null}

        {lineup ? (
          <div className="lineup-list">
            {groups.map((group) => (
              <div className="lineup-group" key={group.label}>
                <div className="lineup-group-label">
                  <span>{group.label}</span>
                  <span className="lineup-col-heads" aria-hidden="true">
                    <span>Pts</span>
                    <span>Proj</span>
                  </span>
                </div>
                {group.rows.map((row) => {
                  if (!row.entry) {
                    return (
                      <div className="row lineup-empty-row" key={row.key}>
                        <PositionBadge slot={row.slot} />
                        <span className="player-main">
                          <span className="player-name empty">Empty</span>
                        </span>
                        <span aria-hidden="true" />
                      </div>
                    );
                  }

                  const player = row.entry.player;
                  const { seasonPts, projPts } = rowPoints(player);
                  const injured = player.status === "injured" || player.status === "day-to-day";

                  return (
                    <div className="row lineup-slot-row" key={row.key}>
                      <PositionBadge slot={row.slot} />
                      <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
                      <span className="player-main">
                        <span className="player-name">{player.name}</span>
                        <span className="player-meta">
                          {player.mlbTeam} &ndash; {player.positions.join(", ")}
                        </span>
                        <span className={injured ? "player-game injury" : "player-game"}>
                          {formatGameLine(player.nextGame, player.status)}
                        </span>
                      </span>
                      <span className="player-points">
                        <span className="points-live">{seasonPts}</span>
                        <span className="points-proj">{projPts}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
