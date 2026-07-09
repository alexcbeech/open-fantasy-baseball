"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayerAvatar } from "@/app/team/[teamId]/player-avatar";
import { PositionBadge } from "@/app/team/[teamId]/position-badge";
import { computeRosterNeeds } from "@/lib/draft/auto-pick";
import type { DraftPlayer, DraftState } from "@/lib/draft/types";
import type { DraftLobby } from "@/lib/data/draft";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { rowPoints } from "@/lib/fantasy/player-view";
import { positionGroupClass, positionGroupLegend } from "@/lib/fantasy/position-color";
import type { RosterSlot } from "@/lib/fantasy/types";
import { PickSheet } from "./pick-sheet";
import { SetupPanel } from "./setup-panel";

const POLL_MS = 3000;
const positionFilters: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const roomTabs = ["Players", "Board", "My Team"] as const;
const sortOptions = [
  { key: "adp", label: "ADP" },
  { key: "proj", label: "Proj Pts" },
  { key: "season", label: "Season Pts" },
] as const;

type SortKey = (typeof sortOptions)[number]["key"];
type RoomTab = (typeof roomTabs)[number];

type DraftRoomProps = {
  lobby: DraftLobby;
  initialDraft: DraftState | null;
  initialPlayers: DraftPlayer[];
};

function pickLabel(round: number, pickInRound: number) {
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
}

export function DraftRoom({ lobby, initialDraft, initialPlayers }: DraftRoomProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(initialDraft);
  const [players, setPlayers] = useState<DraftPlayer[]>(initialPlayers);
  const [tab, setTab] = useState<RoomTab>("Players");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<RosterSlot | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("adp");
  const [sheetPlayerId, setSheetPlayerId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Server-time offset so the countdown never trusts the client clock.
  const clockOffsetRef = useRef(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const wasMyTurnRef = useRef(false);

  const applyDraft = useCallback((next: DraftState) => {
    clockOffsetRef.current = Date.parse(next.serverNow) - Date.now();
    setDraft(next);
  }, []);

  useEffect(() => {
    if (initialDraft) {
      clockOffsetRef.current = Date.parse(initialDraft.serverNow) - Date.now();
    }
  }, [initialDraft]);

  // Poll the draft state; reading also advances expired turns server-side.
  useEffect(() => {
    if (!draft || draft.status === "complete") {
      return;
    }

    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft`);
        if (!response.ok) {
          return;
        }
        const result = (await response.json()) as { draft?: DraftState };
        if (active && result.draft) {
          applyDraft(result.draft);
        }
      } catch {
        // Keep the last known state on a transient failure.
      }
    };

    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [draft, lobby.leagueId, applyDraft]);

  // Refresh the available-player list when the pick count changes.
  const pickCount = draft?.picks.length ?? 0;
  useEffect(() => {
    if (!draft || draft.status === "setup") {
      return;
    }

    let active = true;
    fetch(`/api/v1/leagues/${lobby.leagueId}/draft/players`)
      .then((response) => (response.ok ? response.json() : null))
      .then((result: { players?: DraftPlayer[] } | null) => {
        if (active && result?.players) {
          setPlayers(result.players);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [draft, pickCount, lobby.leagueId]);

  // 1s countdown tick while a clock is running.
  useEffect(() => {
    if (!draft?.deadline || draft.status !== "in_progress") {
      return;
    }

    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [draft?.deadline, draft?.status]);

  const isMyTurn = Boolean(draft?.onClock && draft.myTeamId && draft.onClock.teamId === draft.myTeamId);

  // Nudge when the pick comes around to the viewer.
  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current && typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(200);
    }
    wasMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  const remainingSeconds = useMemo(() => {
    if (!draft?.deadline || draft.status !== "in_progress") {
      return null;
    }

    const remaining = Date.parse(draft.deadline) - (nowTick + clockOffsetRef.current);
    return Math.max(0, Math.ceil(remaining / 1000));
  }, [draft?.deadline, draft?.status, nowTick]);

  const teamsById = useMemo(() => new Map((draft?.teams ?? []).map((team) => [team.teamId, team])), [draft?.teams]);
  const queuedIds = useMemo(() => new Set((draft?.myQueue ?? []).map((entry) => entry.playerId)), [draft?.myQueue]);
  const myPicks = useMemo(
    () => (draft?.myTeamId ? draft.picks.filter((pick) => pick.teamId === draft.myTeamId) : []),
    [draft?.picks, draft?.myTeamId],
  );
  const myNeeds = useMemo(
    () =>
      computeRosterNeeds(
        defaultRosterSlots,
        myPicks.map((pick) => pick.positions),
      ),
    [myPicks],
  );

  const filteredPlayers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matched = players.filter((player) => {
      if (position !== "ALL" && !player.positions.includes(position)) {
        return false;
      }
      return normalized ? player.name.toLowerCase().includes(normalized) : true;
    });

    // ADP keeps the server's rank order (best-available first); the points
    // sorts rank highest-first with unknowns last.
    if (sortKey === "adp") {
      return matched;
    }

    return [...matched].sort((left, right) => {
      const leftPts = sortKey === "proj" ? rowPoints(left).projPts : rowPoints(left).seasonPts;
      const rightPts = sortKey === "proj" ? rowPoints(right).projPts : rowPoints(right).seasonPts;
      return rightPts - leftPts || left.name.localeCompare(right.name);
    });
  }, [players, query, position, sortKey]);

  async function confirmPick(playerId: string) {
    setBusy(true);
    setBanner(null);

    try {
      const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft/pick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      const result = (await response.json()) as { error?: string; draft?: DraftState };

      if (!response.ok || !result.draft) {
        setBanner(result.error ?? "The pick could not be made.");
        return;
      }

      applyDraft(result.draft);
      setSheetPlayerId(null);
    } catch {
      setBanner("The pick could not be made.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (!draft) {
      return;
    }

    const action = draft.status === "paused" ? "resume" : "pause";
    setBusy(true);

    try {
      const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft/pause`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as { error?: string; draft?: DraftState };

      if (!response.ok || !result.draft) {
        setBanner(result.error ?? `Could not ${action} the draft.`);
        return;
      }

      applyDraft(result.draft);
    } catch {
      setBanner(`Could not ${action} the draft.`);
    } finally {
      setBusy(false);
    }
  }

  // Add/remove a player from the viewer's queue; the server returns fresh state.
  async function changeQueue(playerId: string, queued: boolean) {
    setBanner(null);

    try {
      const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft/queue`, {
        method: queued ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId }),
      });
      const result = (await response.json()) as { error?: string; draft?: DraftState };

      if (!response.ok || !result.draft) {
        setBanner(result.error ?? "Could not update your queue.");
        return;
      }

      applyDraft(result.draft);
    } catch {
      setBanner("Could not update your queue.");
    }
  }

  async function setAutoDraft(enabled: boolean) {
    setBusy(true);
    setBanner(null);

    try {
      const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft/auto-pick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = (await response.json()) as { error?: string; draft?: DraftState };

      if (!response.ok || !result.draft) {
        setBanner(result.error ?? "Could not update auto-draft.");
        return false;
      }

      applyDraft(result.draft);
      return true;
    } catch {
      setBanner("Could not update auto-draft.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Exit the draft: turn auto-draft on so the viewer's remaining turns fill
  // themselves (from the queue, else best-available), then leave the room.
  async function exitDraft() {
    if (await setAutoDraft(true)) {
      router.push("/");
    }
  }

  // Setup phase: commissioner configures; everyone else waits.
  if (!draft || draft.status === "setup") {
    if (lobby.viewerIsCommissioner) {
      return <SetupPanel lobby={lobby} draft={draft} onDraftChange={applyDraft} />;
    }

    return (
      <section className="panel">
        <h2>Draft Not Started</h2>
        <div className="empty-state">
          {lobby.leagueName} hasn&apos;t started drafting yet. The commissioner is setting things up — check back soon.
        </div>
      </section>
    );
  }

  if (draft.status === "complete") {
    return (
      <section className="panel" aria-labelledby="draft-complete-heading">
        <h2 id="draft-complete-heading">Draft Complete</h2>
        <p className="subtle">
          All {draft.rounds * draft.teamCount} picks are in. Rosters and starting lineups have been assigned.
        </p>
        {draft.myTeamId ? (
          <Link className="primary-button draft-complete-link" href={`/team/${draft.myTeamId}`}>
            Go to my team
          </Link>
        ) : null}
        <RecentPicks draft={draft} teamsById={teamsById} count={12} />
      </section>
    );
  }

  const onClockTeam = draft.onClock ? teamsById.get(draft.onClock.teamId) : null;
  const sheetPlayer = sheetPlayerId ? (players.find((player) => player.id === sheetPlayerId) ?? null) : null;
  // Mirrors the server rule in makePick: you may pick on your own turn, and the
  // commissioner may pick only for a bot on the clock — never another manager's
  // live turn.
  const canPickNow =
    (isMyTurn || (draft.viewerIsCommissioner && Boolean(onClockTeam?.isBot))) && draft.status === "in_progress";
  const clockClass =
    remainingSeconds !== null && remainingSeconds <= 10 ? "draft-clock-time urgent" : "draft-clock-time";

  return (
    <div className="draft-room">
      <div className={isMyTurn ? "draft-clock-banner my-turn" : "draft-clock-banner"}>
        <div className="draft-clock-info">
          <span className="draft-clock-label">
            {draft.status === "paused" ? "Paused" : isMyTurn ? "You're on the clock!" : "On the clock"}
          </span>
          <span className="draft-clock-team">
            {draft.onClock ? `${pickLabel(draft.onClock.round, draft.onClock.pickInRound)} · ` : ""}
            {onClockTeam?.name ?? "—"}
          </span>
        </div>
        <div className="draft-clock-right">
          {draft.status === "in_progress" && remainingSeconds !== null ? (
            <span className={clockClass} aria-live="off">
              {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
            </span>
          ) : null}
          {draft.viewerIsCommissioner ? (
            <button className="draft-pause-button" type="button" disabled={busy} onClick={togglePause}>
              {draft.status === "paused" ? "Resume" : "Pause"}
            </button>
          ) : null}
        </div>
      </div>

      {draft.myTeamId ? (
        <div className="draft-controls">
          <button
            className={draft.myAutoPick ? "draft-auto-toggle on" : "draft-auto-toggle"}
            type="button"
            disabled={busy}
            aria-pressed={draft.myAutoPick}
            onClick={() => setAutoDraft(!draft.myAutoPick)}
          >
            Auto-draft: {draft.myAutoPick ? "On" : "Off"}
          </button>
          {!draft.myAutoPick ? (
            <button className="draft-exit-button" type="button" disabled={busy} onClick={exitDraft}>
              Exit draft
            </button>
          ) : null}
        </div>
      ) : null}

      {draft.myAutoPick ? (
        <div className="draft-auto-warning" role="alert">
          <strong>Auto-draft is on.</strong> Your picks are being made automatically from your queue, then best available.
          Turn it off to draft manually again.
          <button className="draft-auto-off" type="button" disabled={busy} onClick={() => setAutoDraft(false)}>
            Turn off auto-draft
          </button>
        </div>
      ) : null}

      {banner ? <div className="status-banner bad">{banner}</div> : null}

      {draft.picks.length ? (
        <div className="draft-ticker" aria-label="Recent picks">
          {draft.picks
            .slice(-6)
            .reverse()
            .map((pick) => (
              <span className="draft-ticker-chip" key={pick.overallPick}>
                <strong>{pickLabel(pick.round, pick.pickInRound)}</strong> {pick.playerName}
                <span className="draft-ticker-pos"> {pick.positions[0]}</span>
              </span>
            ))}
        </div>
      ) : null}

      <nav className="tabbar draft-tabbar" aria-label="Draft sections">
        {roomTabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === tab ? "tab active" : "tab"}
            onClick={() => setTab(candidate)}
          >
            {candidate}
          </button>
        ))}
      </nav>

      {tab === "Players" ? (
        <section className="panel" aria-labelledby="draft-players-heading">
          <h2 id="draft-players-heading">Available Players</h2>
          <div className="searchbar">
            <input
              aria-label="Search available players"
              placeholder="Search available players"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="filter-chips" role="group" aria-label="Filter by position">
            <button
              type="button"
              className={position === "ALL" ? "filter-chip active" : "filter-chip"}
              aria-pressed={position === "ALL"}
              onClick={() => setPosition("ALL")}
            >
              All
            </button>
            {positionFilters.map((slot) => (
              <button
                key={slot}
                type="button"
                className={position === slot ? "filter-chip active" : "filter-chip"}
                aria-pressed={position === slot}
                onClick={() => setPosition(slot)}
              >
                {slot}
              </button>
            ))}
          </div>

          <div className="draft-sort" role="group" aria-label="Sort players">
            <span className="draft-sort-label">Sort</span>
            {sortOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={sortKey === option.key ? "filter-chip active" : "filter-chip"}
                aria-pressed={sortKey === option.key}
                onClick={() => setSortKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="player-list-head" aria-hidden="true">
            <span className="draft-adp-rank">#</span>
            <span className="player-list-head-spacer" />
            <span className="player-points">
              <span className="points-live">SZN</span>
              <span className="points-proj">PROJ</span>
            </span>
          </div>

          <div className="player-list" aria-live="polite">
            {filteredPlayers.length ? (
              filteredPlayers.map((player) => {
                const { seasonPts, projPts } = rowPoints(player);

                const queued = queuedIds.has(player.id);

                return (
                  <div className="row players-row" key={player.id}>
                    <button
                      className="players-row-main"
                      type="button"
                      onClick={() => setSheetPlayerId(player.id)}
                      aria-label={`View ${player.name}`}
                    >
                      <span className="draft-adp-rank">{player.adpRank ?? "—"}</span>
                      <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
                      <span className="player-main">
                        <span className="player-name">{player.name}</span>
                        <span className="player-meta">
                          {player.mlbTeam} &ndash; {player.positions.join(", ")}
                          {player.adp !== null ? ` · ADP ${player.adp.toFixed(1)}` : ""}
                        </span>
                      </span>
                      <span className="player-points" aria-hidden="true">
                        <span className="points-live">{seasonPts}</span>
                        <span className="points-proj">{projPts}</span>
                      </span>
                    </button>
                    {draft.myTeamId ? (
                      <button
                        className={queued ? "draft-queue-btn queued" : "draft-queue-btn"}
                        type="button"
                        aria-label={queued ? `Remove ${player.name} from queue` : `Add ${player.name} to queue`}
                        aria-pressed={queued}
                        onClick={() => changeQueue(player.id, queued)}
                      >
                        {queued ? "★" : "☆"}
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="empty-state">No available players match that search.</div>
            )}
          </div>
        </section>
      ) : null}

      {tab === "Board" ? <DraftBoard draft={draft} /> : null}

      {tab === "My Team" ? (
        <section className="panel" aria-labelledby="draft-myteam-heading">
          <h2 id="draft-myteam-heading">My Picks</h2>
          {draft.myTeamId ? (
            <>
              <div className="draft-needs" aria-label="Remaining roster needs">
                {Object.entries(myNeeds)
                  .filter(([slot, count]) => count > 0 && slot !== "BN" && slot !== "IL" && slot !== "NA")
                  .map(([slot, count]) => (
                    <span className="draft-need-chip" key={slot}>
                      {count > 1 ? `${count}× ` : ""}
                      {slot}
                    </span>
                  ))}
              </div>
              {myPicks.length ? (
                <div className="player-list">
                  {myPicks.map((pick) => (
                    <div className="row" key={pick.overallPick}>
                      <PositionBadge slot={pick.positions[0]} />
                      <span className="player-main">
                        <span className="player-name">{pick.playerName}</span>
                        <span className="player-meta">Pick {pickLabel(pick.round, pick.pickInRound)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">You haven&apos;t drafted anyone yet.</div>
              )}

              <h3 className="draft-queue-heading">My Queue</h3>
              <p className="subtle">Auto-pick (on your clock or when auto-drafting) takes the top available queued player.</p>
              {draft.myQueue.length ? (
                <div className="player-list">
                  {draft.myQueue.map((entry, index) => (
                    <div className="row" key={entry.playerId}>
                      <span className="draft-queue-rank">{index + 1}</span>
                      <span className="player-main">
                        <span className="player-name">{entry.playerName}</span>
                        <span className="player-meta">{entry.positions.join(", ")}</span>
                      </span>
                      <button
                        className="draft-queue-btn queued"
                        type="button"
                        aria-label={`Remove ${entry.playerName} from queue`}
                        onClick={() => changeQueue(entry.playerId, true)}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">Your queue is empty. Star players on the Players tab to queue them.</div>
              )}
            </>
          ) : (
            <div className="empty-state">You don&apos;t have a team in this draft.</div>
          )}
        </section>
      ) : null}

      {sheetPlayer ? (
        <PickSheet
          player={sheetPlayer}
          pickLabel={draft.onClock ? pickLabel(draft.onClock.round, draft.onClock.pickInRound) : null}
          canPick={canPickNow}
          disabledReason={
            draft.status === "paused"
              ? "The draft is paused."
              : canPickNow
                ? null
                : `${onClockTeam?.name ?? "Another team"} is on the clock.`
          }
          busy={busy}
          isQueued={draft.myTeamId ? queuedIds.has(sheetPlayer.id) : null}
          onConfirm={() => confirmPick(sheetPlayer.id)}
          onToggleQueue={() => changeQueue(sheetPlayer.id, queuedIds.has(sheetPlayer.id))}
          onClose={() => setSheetPlayerId(null)}
        />
      ) : null}
    </div>
  );
}

function DraftBoard({ draft }: { draft: DraftState }) {
  const picksByOverall = new Map(draft.picks.map((pick) => [pick.overallPick, pick]));
  const rounds = Array.from({ length: draft.rounds }, (_, index) => index + 1);

  return (
    <section className="panel" aria-labelledby="draft-board-heading">
      <h2 id="draft-board-heading">Draft Board</h2>
      <div className="draft-board-legend" aria-label="Position color key">
        {positionGroupLegend.map(({ group, label }) => (
          <span className="draft-legend-item" key={group}>
            <span className={`draft-legend-swatch pos-group-${group}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <div className="draft-board-scroll">
        <table className="draft-board">
          <thead>
            <tr>
              <th className="draft-board-round-head" aria-label="Round" />
              {draft.teams.map((team) => (
                <th key={team.teamId} title={team.name}>
                  {abbreviateTeam(team.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => (
              <tr key={round}>
                <td className="draft-board-round">{round}</td>
                {draft.teams.map((team, teamIndex) => {
                  // Snake: odd rounds run forward, even rounds reverse.
                  const pickInRound = round % 2 === 1 ? teamIndex + 1 : draft.teams.length - teamIndex;
                  const overall = (round - 1) * draft.teams.length + pickInRound;
                  const pick = picksByOverall.get(overall);
                  const isCurrent = draft.onClock?.overallPick === overall;

                  // The position class sets --pos on the whole cell, tinting
                  // its background and left accent (see globals.css).
                  const cellClass = [
                    "draft-cell",
                    isCurrent ? "current" : "",
                    pick ? positionGroupClass(pick.positions[0]) : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <td key={team.teamId} className={cellClass}>
                      {pick ? (
                        <span className="draft-cell-pick">
                          <span className="draft-cell-pos">{pick.positions[0]}</span>
                          <span className="draft-cell-name">{shortName(pick.playerName)}</span>
                        </span>
                      ) : isCurrent ? (
                        <span className="draft-cell-onclock">●</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentPicks({
  draft,
  teamsById,
  count,
}: {
  draft: DraftState;
  teamsById: Map<string, DraftState["teams"][number]>;
  count: number;
}) {
  return (
    <div className="player-list">
      {draft.picks
        .slice(-count)
        .reverse()
        .map((pick) => (
          <div className="row" key={pick.overallPick}>
            <PositionBadge slot={pick.positions[0]} />
            <span className="player-main">
              <span className="player-name">{pick.playerName}</span>
              <span className="player-meta">
                {pickLabel(pick.round, pick.pickInRound)} · {teamsById.get(pick.teamId)?.name ?? "Unknown team"}
              </span>
            </span>
          </div>
        ))}
    </div>
  );
}

function abbreviateTeam(name: string): string {
  const cleaned = name.replace(/^Bot:\s*/, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words
    .slice(0, 3)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

function shortName(fullName: string): string {
  const parts = fullName.split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : fullName;
}
