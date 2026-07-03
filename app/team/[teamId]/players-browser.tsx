"use client";

import { useMemo, useState } from "react";
import { readPlayerStat } from "@/lib/fantasy/scoring";
import type { Player, PlayerDetail } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";
import { PlayerDetailView, type PlayerAction } from "./player-detail-view";
import { PositionBadge } from "./position-badge";

type PlayersBrowserProps = {
  teamId: string;
  players: Player[];
};

type SortMode = "projected-hr" | "season-r" | "availability" | "name";

type DetailState =
  | { kind: "idle"; player: PlayerDetail | null; message: string }
  | { kind: "loading"; player: PlayerDetail | null; message: string }
  | { kind: "success"; player: PlayerDetail; message: string }
  | { kind: "error"; player: PlayerDetail | null; message: string };

function numericStat(player: Player, category: string, projection = false) {
  const value = readPlayerStat(player, category, projection);
  return typeof value === "number" ? value : Number.parseFloat(value.toString()) || 0;
}

export function PlayersBrowser({ teamId, players }: PlayersBrowserProps) {
  const [playerRows, setPlayerRows] = useState(players);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("projected-hr");
  const [detailState, setDetailState] = useState<DetailState>({ kind: "idle", player: null, message: "" });

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = playerRows.filter((player) => {
      if (!normalizedQuery) {
        return true;
      }

      return [player.name, player.mlbTeam, player.availability, player.status, ...player.positions]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });

    return matches.toSorted((left, right) => {
      switch (sortMode) {
        case "projected-hr":
          return numericStat(right, "HR", true) - numericStat(left, "HR", true);
        case "season-r":
          return numericStat(right, "R") - numericStat(left, "R");
        case "availability":
          return left.availability.localeCompare(right.availability) || left.name.localeCompare(right.name);
        case "name":
          return left.name.localeCompare(right.name);
      }
    });
  }, [playerRows, query, sortMode]);

  async function openPlayerDetail(playerId: string) {
    setDetailState((current) => ({ kind: "loading", player: current.player, message: "Loading player..." }));

    try {
      const response = await fetch(`/api/v1/players/${playerId}`);
      const result = (await response.json()) as { player?: PlayerDetail; error?: string };

      if (!response.ok || !result.player) {
        setDetailState({ kind: "error", player: null, message: result.error ?? "Player detail could not be loaded." });
        return;
      }

      setDetailState({ kind: "success", player: result.player, message: "" });
      setPlayerRows((current) => current.map((player) => (player.id === result.player?.id ? result.player : player)));
    } catch {
      setDetailState({ kind: "error", player: null, message: "Player detail could not be loaded." });
    }
  }

  async function applyPlayerAction(action: PlayerAction) {
    const selectedPlayer = detailState.player;

    if (!selectedPlayer) {
      return;
    }

    setDetailState({ kind: "loading", player: selectedPlayer, message: "Applying player action..." });

    try {
      const response = await fetch(`/api/v1/teams/${teamId}/players/${selectedPlayer.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as { player?: PlayerDetail; error?: string };

      if (!response.ok || !result.player) {
        setDetailState({
          kind: "error",
          player: selectedPlayer,
          message: result.error ?? "Player action could not be applied.",
        });
        return;
      }

      setPlayerRows((current) => current.map((player) => (player.id === result.player?.id ? result.player : player)));
      setDetailState({ kind: "success", player: result.player, message: "Player action applied." });
    } catch {
      setDetailState({ kind: "error", player: selectedPlayer, message: "Player action could not be applied." });
    }
  }

  return (
    <div className="content-grid">
      <section className="panel" aria-labelledby="players-heading">
        <h2 id="players-heading">Players</h2>
        <div className="searchbar">
          <input
            aria-label="Search players"
            placeholder="Search all players"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select aria-label="Sort players" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="projected-hr">Sort: Projected HR</option>
            <option value="season-r">Sort: Season R</option>
            <option value="availability">Sort: Availability</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
        <div className="player-list" aria-live="polite">
          {filteredPlayers.length ? (
            filteredPlayers.map((player) => (
              <button className="row players-row" type="button" key={player.id} onClick={() => openPlayerDetail(player.id)}>
                <PositionBadge slot={player.positions[0]} />
                <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
                <span className="player-main">
                  <span className="player-name">{player.name}</span>
                  <span className="player-meta">
                    {player.mlbTeam} &middot; {player.availability} &middot; Proj HR {readPlayerStat(player, "HR", true)}
                  </span>
                </span>
                <span className="pill">{player.status}</span>
              </button>
            ))
          ) : (
            <div className="empty-state">No players match that search.</div>
          )}
        </div>
      </section>

      <PlayerDetailPanel detailState={detailState} onAction={applyPlayerAction} />
    </div>
  );
}

function PlayerDetailPanel({ detailState, onAction }: { detailState: DetailState; onAction: (action: PlayerAction) => void }) {
  const player = detailState.player;

  if (!player) {
    return (
      <aside className="panel player-detail-panel" aria-labelledby="player-detail-heading">
        <h3 id="player-detail-heading">Player Detail</h3>
        {detailState.kind === "error" ? (
          <div className="status-banner bad">{detailState.message}</div>
        ) : (
          <div className="empty-state">
            {detailState.kind === "loading" ? detailState.message : "Select a player to view stats, news, and actions."}
          </div>
        )}
      </aside>
    );
  }

  const statusBanner =
    detailState.kind === "loading"
      ? ({ kind: "good", message: detailState.message } as const)
      : detailState.kind === "error"
        ? ({ kind: "bad", message: detailState.message } as const)
        : detailState.kind === "success" && detailState.message
          ? ({ kind: "good", message: detailState.message } as const)
          : null;

  return (
    <aside className="panel player-detail-panel" aria-labelledby="player-detail-heading">
      <PlayerDetailView
        player={player}
        actionInFlight={detailState.kind === "loading"}
        statusBanner={statusBanner}
        onAction={onAction}
      />
    </aside>
  );
}
