"use client";

import { useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";
import { PositionBadge } from "./position-badge";

const slotOrder: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "P", "BN", "IL", "NA"];

export type MoveTarget = { slot: RosterSlot; swapWithPlayerId?: string };

type MovePlayerSheetProps = {
  mover: LineupPlayer;
  lineup: LineupPlayer[];
  rosterSlots: Record<RosterSlot, number>;
  /** Players whose game has started; they can't be displaced by a swap. */
  lockedPlayerIds?: Set<string>;
  onSelect: (target: MoveTarget) => void;
  onClose: () => void;
};

type MoveOption =
  | { kind: "open"; slot: RosterSlot }
  | { kind: "swap"; slot: RosterSlot; occupant: LineupPlayer };

/**
 * Build the list of legal destinations for the moving player: an open spot
 * where a slot has spare capacity, otherwise a swap with each current occupant
 * of an eligible slot (the occupant takes the mover's vacated slot). Occupants
 * whose game has started are locked in place, so they're never offered as swaps.
 */
function buildMoveOptions(
  mover: LineupPlayer,
  lineup: LineupPlayer[],
  rosterSlots: Record<RosterSlot, number>,
  lockedPlayerIds?: Set<string>,
): MoveOption[] {
  const options: MoveOption[] = [];

  for (const slot of slotOrder) {
    if (slot === mover.slot || !isSlotEligibleForPlayer(mover.player, slot)) {
      continue;
    }

    const occupants = lineup.filter((entry) => entry.player.id !== mover.player.id && entry.slot === slot);
    const limit = rosterSlots[slot] ?? 0;

    if (occupants.length < limit) {
      options.push({ kind: "open", slot });
    } else {
      for (const occupant of occupants) {
        if (lockedPlayerIds?.has(occupant.player.id)) {
          continue;
        }
        options.push({ kind: "swap", slot, occupant });
      }
    }
  }

  return options;
}

export function MovePlayerSheet({ mover, lineup, rosterSlots, lockedPlayerIds, onSelect, onClose }: MovePlayerSheetProps) {
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

  const options = buildMoveOptions(mover, lineup, rosterSlots, lockedPlayerIds);

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-sheet-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet-grabber" aria-hidden="true" />
        <div className="move-sheet-header">
          <h2 id="move-sheet-title">Move Player</h2>
          <button className="move-sheet-close" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <p className="move-sheet-subtitle">
          Select a new position for {mover.player.name} or keep the player in the {mover.slot} slot.
        </p>

        <div className="move-option-list">
          <button className="move-option current" type="button" onClick={onClose}>
            <PositionBadge slot={mover.slot} />
            <span className="move-option-player">
              <PlayerAvatar mlbPlayerId={mover.player.mlbPlayerId} name={mover.player.name} />
              <span className="player-main">
                <span className="player-name">{mover.player.name}</span>
                <span className="player-meta">
                  {mover.player.mlbTeam} &ndash; {mover.player.positions.join(", ")}
                </span>
              </span>
            </span>
            <span className="move-keep-tag">Keep</span>
          </button>

          {options.length ? (
            options.map((option) => {
              const occupant = option.kind === "swap" ? option.occupant.player : null;

              return (
                <button
                  className="move-option"
                  type="button"
                  key={option.kind === "swap" ? `${option.slot}-${option.occupant.player.id}` : `open-${option.slot}`}
                  onClick={() => onSelect({ slot: option.slot, swapWithPlayerId: occupant?.id })}
                >
                  <PositionBadge slot={option.slot} swap />
                  <span className="move-option-player">
                    {occupant ? (
                      <>
                        <PlayerAvatar mlbPlayerId={occupant.mlbPlayerId} name={occupant.name} />
                        <span className="player-main">
                          <span className="player-name">{occupant.name}</span>
                          <span className="player-meta">
                            {occupant.mlbTeam} &ndash; {occupant.positions.join(", ")}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="player-main">
                        <span className="player-name">Open {option.slot} spot</span>
                        <span className="player-meta">Move here without a swap</span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="empty-state">No other eligible slots are open for {mover.player.name}.</div>
          )}
        </div>
      </div>
    </div>
  );
}
