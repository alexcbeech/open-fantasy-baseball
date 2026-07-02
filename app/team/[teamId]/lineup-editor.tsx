"use client";

import { useMemo, useState } from "react";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { MovePlayerSheet, type MoveTarget } from "./move-player-sheet";

type LineupValidationIssue = {
  code: string;
  message: string;
  playerId?: string;
  slot?: RosterSlot;
};

type LineupValidation = {
  valid: boolean;
  issues: LineupValidationIssue[];
};

type LineupEditorProps = {
  teamId: string;
  initialLineup: LineupPlayer[];
  initialValidation: LineupValidation;
};

export function LineupEditor({ teamId, initialLineup, initialValidation }: LineupEditorProps) {
  const [slotByPlayerId, setSlotByPlayerId] = useState(() =>
    Object.fromEntries(initialLineup.map((entry) => [entry.player.id, entry.slot])) as Record<string, RosterSlot>,
  );
  const [validation, setValidation] = useState(initialValidation);
  const [message, setMessage] = useState(initialValidation.valid ? "Legal lineup" : "Lineup needs attention");
  const [isSaving, setIsSaving] = useState(false);
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);

  const currentLineup = useMemo<LineupPlayer[]>(
    () => initialLineup.map((entry) => ({ ...entry, slot: slotByPlayerId[entry.player.id] })),
    [initialLineup, slotByPlayerId],
  );

  const entries = useMemo(
    () => currentLineup.map((entry) => ({ playerId: entry.player.id, slot: entry.slot })),
    [currentLineup],
  );

  const movingEntry = movingPlayerId ? currentLineup.find((entry) => entry.player.id === movingPlayerId) : undefined;

  function applyMove(target: MoveTarget) {
    if (!movingPlayerId) {
      return;
    }

    setSlotByPlayerId((current) => {
      const vacatedSlot = current[movingPlayerId];
      const next = { ...current, [movingPlayerId]: target.slot };

      if (target.swapWithPlayerId) {
        const displaced = currentLineup.find((entry) => entry.player.id === target.swapWithPlayerId);
        // The displaced player takes the vacated slot when eligible; otherwise
        // they drop to the bench so the swap never creates an illegal slot.
        next[target.swapWithPlayerId] =
          displaced && isSlotEligibleForPlayer(displaced.player, vacatedSlot) ? vacatedSlot : "BN";
      }

      return next;
    });
    setMovingPlayerId(null);
  }

  async function validateMoves() {
    setIsSaving(true);
    setMessage("Checking lineup...");

    try {
      const response = await fetch(`/api/v1/teams/${teamId}/lineup`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ entries }),
      });

      const result = (await response.json()) as {
        accepted?: boolean;
        validation?: LineupValidation;
        error?: string;
      };

      if (!response.ok || !result.validation) {
        setMessage(result.error ?? "Could not validate lineup.");
        return;
      }

      setValidation(result.validation);
      setMessage(result.accepted ? "Lineup moves are valid" : "Lineup moves need changes");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <section className="panel" aria-labelledby="lineup-heading">
        <h2 id="lineup-heading">Lineup</h2>
        <div className="lineup-list">
          {currentLineup.map((entry) => (
            <button
              className="row editable-row lineup-move-row"
              type="button"
              key={entry.player.id}
              onClick={() => setMovingPlayerId(entry.player.id)}
              aria-label={`Move ${entry.player.name} out of the ${entry.slot} slot`}
            >
              <span className="slot">{entry.slot}</span>
              <span className="player-main">
                <span className="player-name">{entry.player.name}</span>
                <span className="player-meta">
                  {entry.player.mlbTeam} - {entry.player.positions.join(", ")} - {entry.player.status}
                </span>
              </span>
              <span className="move-indicator" aria-hidden="true">
                &#8645;
              </span>
            </button>
          ))}
          <button className="primary-button" type="button" onClick={validateMoves} disabled={isSaving}>
            {isSaving ? "Checking..." : "Validate Moves"}
          </button>
        </div>
      </section>

      {movingEntry ? (
        <MovePlayerSheet
          mover={movingEntry}
          lineup={currentLineup}
          rosterSlots={defaultRosterSlots}
          onSelect={applyMove}
          onClose={() => setMovingPlayerId(null)}
        />
      ) : null}

      <aside className="panel" aria-labelledby="lineup-status-heading">
        <h3 id="lineup-status-heading">Lineup Status</h3>
        <div className={validation.valid ? "status-banner good" : "status-banner bad"}>{message}</div>
        {validation.issues.length ? (
          <div className="issue-list" aria-label="Lineup validation issues">
            {validation.issues.map((issue) => (
              <div className="issue-row" key={`${issue.code}-${issue.playerId ?? issue.slot ?? issue.message}`}>
                {issue.message}
              </div>
            ))}
          </div>
        ) : null}
      </aside>
    </>
  );
}
