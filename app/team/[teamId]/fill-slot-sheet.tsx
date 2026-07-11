"use client";

import { useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";
import { PositionBadge } from "./position-badge";

const reserveSlots: RosterSlot[] = ["BN", "IL", "NA"];

type FillSlotSheetProps = {
  slot: RosterSlot;
  lineup: LineupPlayer[];
  /** Players whose game has started; they're locked and can't be promoted. */
  lockedPlayerIds?: Set<string>;
  onSelect: (playerId: string) => void;
  onClose: () => void;
};

export function FillSlotSheet({ slot, lineup, lockedPlayerIds, onSelect, onClose }: FillSlotSheetProps) {
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

  // Any player eligible for the slot who is not already in it and whose game
  // hasn't started (started players are locked in place). Reserve players
  // (bench/IL/minors) surface first since they are the usual promotions.
  const candidates = lineup
    .filter((entry) => entry.slot !== slot && isSlotEligibleForPlayer(entry.player, slot) && !lockedPlayerIds?.has(entry.player.id))
    .sort((left, right) => {
      const leftReserve = reserveSlots.includes(left.slot) ? 0 : 1;
      const rightReserve = reserveSlots.includes(right.slot) ? 0 : 1;
      return leftReserve - rightReserve || left.player.name.localeCompare(right.player.name);
    });

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fill-sheet-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet-grabber" aria-hidden="true" />
        <div className="move-sheet-header">
          <h2 id="fill-sheet-title">Fill {slot} slot</h2>
          <button className="move-sheet-close" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <p className="move-sheet-subtitle">Choose an eligible player to start at {slot}.</p>

        <div className="move-option-list">
          {candidates.length ? (
            candidates.map((entry) => (
              <button className="move-option" type="button" key={entry.player.id} onClick={() => onSelect(entry.player.id)}>
                <PositionBadge slot={entry.slot} swap />
                <span className="move-option-player">
                  <PlayerAvatar mlbPlayerId={entry.player.mlbPlayerId} name={entry.player.name} />
                  <span className="player-main">
                    <span className="player-name">{entry.player.name}</span>
                    <span className="player-meta">
                      {entry.player.mlbTeam} &ndash; {entry.player.positions.join(", ")}
                    </span>
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="empty-state">No eligible players are available for {slot}.</div>
          )}
        </div>
      </div>
    </div>
  );
}
