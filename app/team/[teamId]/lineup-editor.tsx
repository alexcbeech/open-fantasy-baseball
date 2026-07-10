"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { formatGameLine, liveLineSummary, rowPoints } from "@/lib/fantasy/player-view";
import {
  findLineupLockIssues,
  isLineupFirstGameLocked,
  isPlayerGameLocked,
  isSlotEligibleForPlayer,
  validateLineup,
} from "@/lib/fantasy/roster-validation";
import { planActiveLineup } from "@/lib/fantasy/start-active-players";
import type { LineupLockMode, LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { FillSlotSheet } from "./fill-slot-sheet";
import { MovePlayerSheet, type MoveTarget } from "./move-player-sheet";
import { PlayerAvatar } from "./player-avatar";
import { PlayerDetailSheet } from "./player-detail-sheet";
import { PositionBadge } from "./position-badge";

type LineupEditorProps = {
  teamId: string;
  initialLineup: LineupPlayer[];
  /** League lock mode: daily per-player locks or whole-lineup first-game. */
  lockMode?: LineupLockMode;
};

type LiveEntry = { state: string | null; points: number; stats?: Record<string, number | string> };

export type SlotRow = { key: string; slot: RosterSlot; entry: LineupPlayer | null };
export type LineupGroup = { label: string; rows: SlotRow[] };

const batterSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL"];
const pitcherSlots: RosterSlot[] = ["SP", "RP", "P"];

/**
 * Turn the flat lineup into a slot-oriented view: every starting slot is shown
 * (filled or empty) so a vacated position reads as an open slot, while reserve
 * sections only list the players actually parked there. Starters are split into
 * Batters and Pitchers, Yahoo-style. Shared with the read-only team lineup
 * sheet on the League tab.
 */
export function buildLineupGroups(lineup: LineupPlayer[], rosterSlots: Record<RosterSlot, number>): LineupGroup[] {
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

function slotsFromLineup(lineup: LineupPlayer[]): Record<string, RosterSlot> {
  return Object.fromEntries(lineup.map((entry) => [entry.player.id, entry.slot])) as Record<string, RosterSlot>;
}

export function LineupEditor({ teamId, initialLineup, lockMode = "daily" }: LineupEditorProps) {
  const router = useRouter();
  const [slotByPlayerId, setSlotByPlayerId] = useState(() => slotsFromLineup(initialLineup));
  const [error, setError] = useState<string | null>(null);
  const [movingPlayerId, setMovingPlayerId] = useState<string | null>(null);
  const [fillingSlot, setFillingSlot] = useState<RosterSlot | null>(null);
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveEntry>>({});

  // Resync when the server lineup changes underneath us (e.g. router.refresh()
  // after an add/drop), so the editor never renders players that left the team.
  useEffect(() => {
    setSlotByPlayerId(slotsFromLineup(initialLineup));
  }, [initialLineup]);

  // Live in-game overlay: while games are in progress, poll each rostered
  // player's live line so the row's bold number becomes today's live points and
  // the game line becomes the inning plus the in-game stat line. Players with
  // no game in progress are absent from the map and keep their season/next-game
  // display.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/teams/${teamId}/live`);
        if (!response.ok) {
          return;
        }
        const result = (await response.json()) as { live?: Record<string, LiveEntry> };
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
    () =>
      initialLineup
        .filter((entry) => slotByPlayerId[entry.player.id] !== undefined)
        .map((entry) => ({ ...entry, slot: slotByPlayerId[entry.player.id] })),
    [initialLineup, slotByPlayerId],
  );

  const groups = useMemo(() => buildLineupGroups(currentLineup, defaultRosterSlots), [currentLineup]);

  // In first-game mode the whole lineup locks at the day's earliest first
  // pitch; otherwise a player locks when their own game starts. The live
  // overlay is a backstop either way.
  const wholeLineupLocked = useMemo(
    () => lockMode === "first-game" && isLineupFirstGameLocked(currentLineup),
    [lockMode, currentLineup],
  );
  const isEntryLocked = useCallback(
    (entry: LineupPlayer) => wholeLineupLocked || isPlayerGameLocked(entry.player) || Boolean(live[entry.player.id]),
    [live, wholeLineupLocked],
  );
  const lockedPlayerIds = useMemo(
    () => new Set(currentLineup.filter(isEntryLocked).map((entry) => entry.player.id)),
    [currentLineup, isEntryLocked],
  );

  const movingEntry = movingPlayerId ? currentLineup.find((entry) => entry.player.id === movingPlayerId) : undefined;

  // Auto-clear the illegal-move notice so it never lingers past the next action.
  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  /** Persist the committed slots; on rejection, roll back to the prior state. */
  async function persistSlots(nextSlots: Record<string, RosterSlot>, previousSlots: Record<string, RosterSlot>) {
    try {
      const response = await fetch(`/api/v1/teams/${teamId}/lineup`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: Object.entries(nextSlots).map(([playerId, slot]) => ({ playerId, slot })),
        }),
      });
      const result = (await response.json()) as {
        accepted?: boolean;
        error?: string;
        validation?: { issues?: Array<{ message: string }> };
      };

      if (!response.ok || !result.accepted) {
        setSlotByPlayerId(previousSlots);
        setError(result.validation?.issues?.[0]?.message ?? result.error ?? "Lineup change could not be saved.");
      }
    } catch {
      setSlotByPlayerId(previousSlots);
      setError("Lineup change could not be saved.");
    }
  }

  /**
   * Validate the proposed slot assignment before committing it. The move/fill
   * sheets only ever offer legal destinations, so this is a guard rail: a move
   * that would produce an illegal lineup (or touch a game-locked player) is
   * rejected and surfaced inline. Legal moves apply optimistically and persist
   * through the lineup API, rolling back if the server rejects them.
   */
  function commitSlots(nextSlots: Record<string, RosterSlot>) {
    const nextLineup = initialLineup.map((entry) => ({ ...entry, slot: nextSlots[entry.player.id] }));
    const result = validateLineup(nextLineup);

    if (!result.valid) {
      setError(result.issues[0]?.message ?? "That move would create an illegal lineup.");
      return false;
    }

    const lockIssues = findLineupLockIssues(currentLineup, nextLineup, new Date(), lockMode);
    // The scheduled-start check misses games the schedule sync hasn't seen;
    // the live overlay is the backstop for anyone already playing.
    const liveLockedMove = nextLineup.find(
      (entry) => live[entry.player.id] && slotByPlayerId[entry.player.id] !== entry.slot,
    );

    if (lockIssues.length || liveLockedMove) {
      setError(
        lockIssues[0]?.message ??
          `${liveLockedMove?.player.name} is locked: their game has started. Lineup changes reopen at the next daily rollover.`,
      );
      return false;
    }

    setError(null);
    const previousSlots = slotByPlayerId;
    setSlotByPlayerId(nextSlots);
    void persistSlots(nextSlots, previousSlots);
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

  /**
   * One-tap optimal lineup: seat players with a game today (probable starters
   * for SP slots) by projected points then ADP, bench the rest. Locked and
   * IL/NA players stay put; the result goes through the same validate/commit
   * path as a manual move.
   */
  function startActivePlayers() {
    const next = planActiveLineup(currentLineup, lockedPlayerIds);
    const changed = currentLineup.some((entry) => next[entry.player.id] !== entry.slot);

    if (changed) {
      commitSlots(next);
    }
  }

  function startMove(entry: LineupPlayer) {
    if (isEntryLocked(entry)) {
      setError(`${entry.player.name} is locked: their game has started. Lineup changes reopen at the next daily rollover.`);
      return;
    }
    setMovingPlayerId(entry.player.id);
  }

  return (
    <>
      <section className="panel" aria-labelledby="lineup-heading">
        <div className="lineup-header">
          <h2 id="lineup-heading">Lineup</h2>
          <button className="start-active-button" type="button" onClick={startActivePlayers}>
            Start Active Players
          </button>
        </div>
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
                    const entry = row.entry;
                    const player = entry.player;
                    const { seasonPts, projPts } = rowPoints(player);
                    const liveEntry = live[player.id];
                    const locked = isEntryLocked(entry);
                    const boldPts = liveEntry ? liveEntry.points : seasonPts;
                    const injured = player.status === "injured" || player.status === "day-to-day";
                    const gameLine = liveEntry?.state ?? formatGameLine(player.nextGame, player.status);
                    const gameClass = liveEntry ? "player-game is-live" : injured ? "player-game injury" : "player-game";
                    const liveStatLine = liveEntry?.stats ? liveLineSummary(liveEntry.stats) : null;

                    return (
                      <div className="row editable-row lineup-slot-row" key={row.key}>
                        <button
                          className={locked ? "pos-badge-button is-locked" : "pos-badge-button"}
                          type="button"
                          onClick={() => startMove(entry)}
                          aria-disabled={locked}
                          aria-label={
                            locked
                              ? `${player.name} is locked in the ${row.slot} slot until the next daily rollover`
                              : `Move ${player.name} out of the ${row.slot} slot`
                          }
                          title={locked ? "Locked: game started" : undefined}
                        >
                          <PositionBadge slot={row.slot} swap={!locked} />
                          {locked ? (
                            <span className="slot-lock" aria-hidden="true">
                              &#128274;
                            </span>
                          ) : null}
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
                          {liveStatLine ? <span className="player-live-line">{liveStatLine}</span> : null}
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
          lockedPlayerIds={lockedPlayerIds}
          onSelect={applyMove}
          onClose={() => setMovingPlayerId(null)}
        />
      ) : null}

      {fillingSlot ? (
        <FillSlotSheet
          slot={fillingSlot}
          lineup={currentLineup}
          lockedPlayerIds={lockedPlayerIds}
          onSelect={fillSlot}
          onClose={() => setFillingSlot(null)}
        />
      ) : null}

      {detailPlayerId ? (
        <PlayerDetailSheet
          playerId={detailPlayerId}
          teamId={teamId}
          onClose={() => setDetailPlayerId(null)}
          onRosterChange={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
