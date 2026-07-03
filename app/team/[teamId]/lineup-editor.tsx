"use client";

import { useMemo, useState } from "react";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { FillSlotSheet } from "./fill-slot-sheet";
import { MovePlayerSheet, type MoveTarget } from "./move-player-sheet";
import { PlayerAvatar } from "./player-avatar";
import { PlayerDetailSheet } from "./player-detail-sheet";
import { PositionBadge } from "./position-badge";

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

type SlotRow = { key: string; slot: RosterSlot; player: LineupPlayer["player"] | null };
type LineupGroup = { label: string; rows: SlotRow[] };

const batterSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL"];
const pitcherSlots: RosterSlot[] = ["SP", "RP", "P"];

/**
 * Turn the flat lineup into a slot-oriented view: every starting slot is shown
 * (filled or empty) so a vacated position reads as an open slot, while reserve
 * sections only list the players actually parked there. Starters are split into
 * Batters and Pitchers, Yahoo-style.
 */
function buildLineupGroups(lineup: LineupPlayer[], rosterSlots: Record<RosterSlot, number>): LineupGroup[] {
  const occupantsBySlot = new Map<RosterSlot, LineupPlayer[]>();
  for (const entry of lineup) {
    occupantsBySlot.set(entry.slot, [...(occupantsBySlot.get(entry.slot) ?? []), entry]);
  }

  const buildRows = (slots: RosterSlot[]): SlotRow[] => {
    const rows: SlotRow[] = [];
    for (const slot of slots) {
      const occupants = occupantsBySlot.get(slot) ?? [];
      const rowCount = Math.max(rosterSlots[slot] ?? 0, occupants.length);
      for (let index = 0; index < rowCount; index += 1) {
        rows.push({ key: `${slot}-${index}`, slot, player: occupants[index]?.player ?? null });
      }
    }
    return rows;
  };

  const groups: LineupGroup[] = [
    { label: "Batters", rows: buildRows(batterSlots) },
    { label: "Pitchers", rows: buildRows(pitcherSlots) },
  ];

  const reserves: Array<{ slot: RosterSlot; label: string }> = [
    { slot: "BN", label: "Bench" },
    { slot: "IL", label: "Injured List" },
    { slot: "NA", label: "Minors" },
  ];
  for (const { slot, label } of reserves) {
    const occupants = occupantsBySlot.get(slot) ?? [];
    if (occupants.length) {
      groups.push({
        label,
        rows: occupants.map((entry, index) => ({ key: `${slot}-${index}`, slot, player: entry.player })),
      });
    }
  }

  return groups;
}

export function LineupEditor({ teamId, initialLineup, initialValidation }: LineupEditorProps) {
  const [slotByPlayerId, setSlotByPlayerId] = useState(() =>
    Object.fromEntries(initialLineup.map((entry) => [entry.player.id, entry.slot])) as Record<string, RosterSlot>,
  );
  const [validation, setValidation] = useState(initialValidation);
  const [message, setMessage] = useState(initialValidation.valid ? "Legal lineup" : "Lineup needs attention");
  const [isSaving, setIsSaving] = useState(false);
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);
  const [fillingSlot, setFillingSlot] = useState<RosterSlot | null>(null);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);

  const currentLineup = useMemo<LineupPlayer[]>(
    () => initialLineup.map((entry) => ({ ...entry, slot: slotByPlayerId[entry.player.id] })),
    [initialLineup, slotByPlayerId],
  );

  const groups = useMemo(() => buildLineupGroups(currentLineup, defaultRosterSlots), [currentLineup]);

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

  function fillSlot(playerId: string) {
    if (!fillingSlot) {
      return;
    }

    setSlotByPlayerId((current) => ({ ...current, [playerId]: fillingSlot }));
    setFillingSlot(null);
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
          {groups.map((group) => (
            <div className="lineup-group" key={group.label}>
              <div className="lineup-group-label">{group.label}</div>
              {group.rows.map((row) =>
                row.player ? (
                  <div className="row editable-row lineup-slot-row" key={row.key}>
                    <button
                      className="pos-badge-button"
                      type="button"
                      onClick={() => setMovingPlayerId(row.player!.id)}
                      aria-label={`Move ${row.player.name} out of the ${row.slot} slot`}
                    >
                      <PositionBadge slot={row.slot} swap />
                    </button>
                    <PlayerAvatar mlbPlayerId={row.player.mlbPlayerId} name={row.player.name} />
                    <button
                      className="player-main player-info-button"
                      type="button"
                      onClick={() => setDetailPlayerId(row.player!.id)}
                      aria-label={`View ${row.player.name} details`}
                    >
                      <span className="player-name">{row.player.name}</span>
                      <span className="player-meta">
                        {row.player.mlbTeam} &middot; {row.player.positions.join(", ")} &middot; {row.player.status}
                      </span>
                    </button>
                    <span className="detail-chevron" aria-hidden="true">
                      &rsaquo;
                    </span>
                  </div>
                ) : (
                  <button
                    className="row editable-row lineup-empty-row"
                    type="button"
                    key={row.key}
                    onClick={() => setFillingSlot(row.slot)}
                    aria-label={`Fill the empty ${row.slot} slot`}
                  >
                    <PositionBadge slot={row.slot} />
                    <span className="player-main">
                      <span className="player-name empty">Empty</span>
                      <span className="player-meta">Tap to add a player</span>
                    </span>
                    <span className="move-indicator" aria-hidden="true">
                      +
                    </span>
                  </button>
                ),
              )}
            </div>
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

      {fillingSlot ? (
        <FillSlotSheet slot={fillingSlot} lineup={currentLineup} onSelect={fillSlot} onClose={() => setFillingSlot(null)} />
      ) : null}

      {detailPlayerId ? (
        <PlayerDetailSheet playerId={detailPlayerId} teamId={teamId} onClose={() => setDetailPlayerId(null)} />
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
