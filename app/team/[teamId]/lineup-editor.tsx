"use client";

import { useEffect, useMemo, useState } from "react";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { formatGameLine, rowPoints } from "@/lib/fantasy/player-view";
import { isSlotEligibleForPlayer, validateLineup } from "@/lib/fantasy/roster-validation";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { FillSlotSheet } from "./fill-slot-sheet";
import { MovePlayerSheet, type MoveTarget } from "./move-player-sheet";
import { PlayerAvatar } from "./player-avatar";
import { PlayerDetailSheet } from "./player-detail-sheet";
import { PositionBadge } from "./position-badge";

type LineupEditorProps = {
  teamId: string;
  initialLineup: LineupPlayer[];
};

type SlotRow = { key: string; slot: RosterSlot; entry: LineupPlayer | null };
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
        rows.push({ key: `${slot}-${index}`, slot, entry: occupants[index] ?? null });
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
        rows: occupants.map((entry, index) => ({ key: `${slot}-${index}`, slot, entry })),
      });
    }
  }

  return groups;
}

export function LineupEditor({ teamId, initialLineup }: LineupEditorProps) {
  const [slotByPlayerId, setSlotByPlayerId] = useState(() =>
    Object.fromEntries(initialLineup.map((entry) => [entry.player.id, entry.slot])) as Record<string, RosterSlot>,
  );
  const [error, setError] = useState<string | null>(null);
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);
  const [fillingSlot, setFillingSlot] = useState<RosterSlot | null>(null);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, { state: string | null; points: number }>>({});

  // Live in-game overlay: while games are in progress, poll each rostered
  // player's live line so the row's bold number becomes today's live points and
  // the game line becomes the inning. Players with no game in progress are
  // absent from the map and keep their season/next-game display.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/teams/${teamId}/live`);
        if (!response.ok) {
          return;
        }
        const result = (await response.json()) as { live?: Record<string, { state: string | null; points: number }> };
        if (active && result.live) {
          setLive(result.live);
        }
      } catch {
        // Keep the last known live map on a transient failure.
      }
    };

    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [teamId]);

  const currentLineup = useMemo<LineupPlayer[]>(
    () => initialLineup.map((entry) => ({ ...entry, slot: slotByPlayerId[entry.player.id] })),
    [initialLineup, slotByPlayerId],
  );

  const groups = useMemo(() => buildLineupGroups(currentLineup, defaultRosterSlots), [currentLineup]);

  const movingEntry = movingPlayerId ? currentLineup.find((entry) => entry.player.id === movingPlayerId) : undefined;

  // Auto-clear the illegal-move notice so it never lingers past the next action.
  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  /**
   * Validate the proposed slot assignment before committing it. The move/fill
   * sheets only ever offer legal destinations, so this is a guard rail: a move
   * that would produce an illegal lineup is rejected and surfaced inline rather
   * than requiring a separate "validate" step.
   */
  function commitSlots(nextSlots: Record<string, RosterSlot>) {
    const nextLineup = initialLineup.map((entry) => ({ ...entry, slot: nextSlots[entry.player.id] }));
    const result = validateLineup(nextLineup);

    if (!result.valid) {
      setError(result.issues[0]?.message ?? "That move would create an illegal lineup.");
      return false;
    }

    setError(null);
    setSlotByPlayerId(nextSlots);
    return true;
  }

  function applyMove(target: MoveTarget) {
    if (!movingPlayerId) {
      return;
    }

    const vacatedSlot = slotByPlayerId[movingPlayerId];
    const next = { ...slotByPlayerId, [movingPlayerId]: target.slot };

    if (target.swapWithPlayerId) {
      const displaced = currentLineup.find((entry) => entry.player.id === target.swapWithPlayerId);
      // The displaced player takes the vacated slot when eligible; otherwise
      // they drop to the bench so the swap never creates an illegal slot.
      next[target.swapWithPlayerId] =
        displaced && isSlotEligibleForPlayer(displaced.player, vacatedSlot) ? vacatedSlot : "BN";
    }

    commitSlots(next);
    setMovingPlayerId(null);
  }

  function fillSlot(playerId: string) {
    if (!fillingSlot) {
      return;
    }

    commitSlots({ ...slotByPlayerId, [playerId]: fillingSlot });
    setFillingSlot(null);
  }

  return (
    <>
      <section className="panel" aria-labelledby="lineup-heading">
        <h2 id="lineup-heading">Lineup</h2>
        {error ? (
          <div className="status-banner bad" role="alert">
            {error}
          </div>
        ) : null}
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
              {group.rows.map((row) =>
                row.entry ? (
                  (() => {
                    const player = row.entry.player;
                    const { seasonPts, projPts } = rowPoints(player);
                    const liveEntry = live[player.id];
                    const boldPts = liveEntry ? liveEntry.points : seasonPts;
                    const injured = player.status === "injured" || player.status === "day-to-day";
                    const gameLine = liveEntry?.state ?? formatGameLine(player.nextGame, player.status);
                    const gameClass = liveEntry ? "player-game is-live" : injured ? "player-game injury" : "player-game";

                    return (
                      <div className="row editable-row lineup-slot-row" key={row.key}>
                        <button
                          className="pos-badge-button"
                          type="button"
                          onClick={() => setMovingPlayerId(player.id)}
                          aria-label={`Move ${player.name} out of the ${row.slot} slot`}
                        >
                          <PositionBadge slot={row.slot} swap />
                        </button>
                        <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
                        <button
                          className="player-main player-info-button"
                          type="button"
                          onClick={() => setDetailPlayerId(player.id)}
                          aria-label={`View ${player.name} details`}
                        >
                          <span className="player-name">{player.name}</span>
                          <span className="player-meta">
                            {player.mlbTeam} &ndash; {player.positions.join(", ")}
                          </span>
                          <span className={gameClass}>{gameLine}</span>
                        </button>
                        <button
                          className="player-points"
                          type="button"
                          onClick={() => setDetailPlayerId(player.id)}
                          aria-label={
                            liveEntry
                              ? `${player.name}: ${boldPts} live fantasy points, ${projPts} projected`
                              : `${player.name}: ${seasonPts} season fantasy points, ${projPts} projected`
                          }
                        >
                          <span className={liveEntry ? "points-live is-live" : "points-live"}>{boldPts}</span>
                          <span className="points-proj">{projPts}</span>
                        </button>
                      </div>
                    );
                  })()
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
    </>
  );
}
