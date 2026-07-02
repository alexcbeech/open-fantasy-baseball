"use client";

import { useMemo, useState } from "react";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";

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

const editableSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "P", "BN", "IL", "NA"];

export function LineupEditor({ teamId, initialLineup, initialValidation }: LineupEditorProps) {
  const [slotByPlayerId, setSlotByPlayerId] = useState(() =>
    Object.fromEntries(initialLineup.map((entry) => [entry.player.id, entry.slot])) as Record<string, RosterSlot>,
  );
  const [validation, setValidation] = useState(initialValidation);
  const [message, setMessage] = useState(initialValidation.valid ? "Legal lineup" : "Lineup needs attention");
  const [isSaving, setIsSaving] = useState(false);

  const entries = useMemo(
    () =>
      initialLineup.map((entry) => ({
        playerId: entry.player.id,
        slot: slotByPlayerId[entry.player.id],
      })),
    [initialLineup, slotByPlayerId],
  );

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
          {initialLineup.map((entry) => (
            <div className="row editable-row" key={`${entry.slot}-${entry.player.id}`}>
              <span className="slot">{slotByPlayerId[entry.player.id]}</span>
              <span className="player-main">
                <span className="player-name">{entry.player.name}</span>
                <span className="player-meta">
                  {entry.player.mlbTeam} - {entry.player.positions.join(", ")} - {entry.player.status}
                </span>
              </span>
              <select
                aria-label={`Move ${entry.player.name}`}
                value={slotByPlayerId[entry.player.id]}
                onChange={(event) =>
                  setSlotByPlayerId((current) => ({
                    ...current,
                    [entry.player.id]: event.target.value as RosterSlot,
                  }))
                }
              >
                {editableSlots.map((slot) => (
                  <option value={slot} key={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button className="primary-button" type="button" onClick={validateMoves} disabled={isSaving}>
            {isSaving ? "Checking..." : "Validate Moves"}
          </button>
        </div>
      </section>

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
