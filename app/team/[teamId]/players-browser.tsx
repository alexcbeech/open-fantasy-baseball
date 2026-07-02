"use client";

import { useMemo, useState } from "react";
import { readPlayerStat } from "@/lib/fantasy/scoring";
import type { Player, PlayerDetail, PlayerGameLog, PlayerStatWindow } from "@/lib/fantasy/types";

type PlayersBrowserProps = {
  teamId: string;
  players: Player[];
};

type SortMode = "projected-hr" | "season-r" | "availability" | "name";
type PlayerAction = "add" | "drop" | "move-to-il" | "move-to-na";

type DetailState =
  | { kind: "idle"; player: PlayerDetail | null; message: string }
  | { kind: "loading"; player: PlayerDetail | null; message: string }
  | { kind: "success"; player: PlayerDetail; message: string }
  | { kind: "error"; player: PlayerDetail | null; message: string };

const primaryStats = ["R", "HR", "RBI", "SB", "AVG", "W", "SV", "K", "ERA", "WHIP"];

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
              <button className="row" type="button" key={player.id} onClick={() => openPlayerDetail(player.id)}>
                <span className="slot">{player.positions[0]}</span>
                <span className="player-main">
                  <span className="player-name">{player.name}</span>
                  <span className="player-meta">
                    {player.mlbTeam} - {player.availability} - Proj HR {readPlayerStat(player, "HR", true)}
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
  if (detailState.kind === "idle") {
    return (
      <aside className="panel player-detail-panel" aria-labelledby="player-detail-heading">
        <h3 id="player-detail-heading">Player Detail</h3>
        <div className="empty-state">Select a player to view stats, news, and actions.</div>
      </aside>
    );
  }

  if (detailState.kind === "error" && !detailState.player) {
    return (
      <aside className="panel player-detail-panel" aria-labelledby="player-detail-heading">
        <h3 id="player-detail-heading">Player Detail</h3>
        <div className="status-banner bad">{detailState.message}</div>
      </aside>
    );
  }

  const player = detailState.player;
  const actionInFlight = detailState.kind === "loading";

  if (!player) {
    return (
      <aside className="panel player-detail-panel" aria-labelledby="player-detail-heading">
        <h3 id="player-detail-heading">Player Detail</h3>
        <div className="empty-state">{detailState.message}</div>
      </aside>
    );
  }

  return (
    <aside className="panel player-detail-panel" aria-labelledby="player-detail-heading">
      <div className="player-detail-header">
        <div>
          <h3 id="player-detail-heading">{player.name}</h3>
          <span className="player-meta">
            {player.mlbTeam} - {player.positions.join(", ")} - {player.availability}
          </span>
        </div>
        <span className="pill">{player.status}</span>
      </div>

      {detailState.kind === "loading" ? <div className="status-banner good">{detailState.message}</div> : null}
      {detailState.kind === "error" ? <div className="status-banner bad">{detailState.message}</div> : null}
      {detailState.kind === "success" && detailState.message ? <div className="status-banner good">{detailState.message}</div> : null}

      <div className="player-actions" aria-label="Player management actions">
        <button className="secondary-button" type="button" disabled={actionInFlight || !player.management.canAdd} onClick={() => onAction("add")}>
          Add
        </button>
        <button className="secondary-button" type="button" disabled={actionInFlight || !player.management.canDrop} onClick={() => onAction("drop")}>
          Drop
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={actionInFlight || !player.management.canMoveToIL}
          onClick={() => onAction("move-to-il")}
        >
          IL
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={actionInFlight || !player.management.canMoveToNA}
          onClick={() => onAction("move-to-na")}
        >
          NA
        </button>
      </div>

      <PlayerStatWindows windows={player.statWindows} fallbackPlayer={player} />

      <PlayerGameLogRows games={player.gameLog} />

      <section aria-labelledby="player-news-heading">
        <h3 id="player-news-heading">News</h3>
        <div className="setting-list">
          {player.news.length ? (
            player.news.map((item) => (
              <div className="news-row" key={item.id}>
                <span className="player-name">{item.headline}</span>
                <span className="player-meta">
                  {item.source} - {new Date(item.publishedAt).toLocaleDateString()}
                </span>
                {item.summary ? <span className="subtle">{item.summary}</span> : null}
              </div>
            ))
          ) : (
            <div className="empty-state">No recent player news.</div>
          )}
        </div>
      </section>
    </aside>
  );
}

function PlayerGameLogRows({ games }: { games: PlayerGameLog[] }) {
  return (
    <section aria-labelledby="player-game-log-heading">
      <h3 id="player-game-log-heading">Game Log</h3>
      <div className="game-log-list">
        {games.length ? (
          games.map((game) => (
            <div className="game-log-row" key={game.id}>
              <span className="player-meta">{new Date(game.date).toLocaleDateString()}</span>
              <div className="stat-chip-grid">
                {primaryStats
                  .filter((category) => game.stats[category] !== undefined)
                  .slice(0, 5)
                  .map((category) => (
                    <span className="stat-chip" key={category}>
                      <span>{category}</span>
                      <strong>{game.stats[category]}</strong>
                    </span>
                  ))}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">No recent game log available.</div>
        )}
      </div>
    </section>
  );
}

function PlayerStatWindows({ windows, fallbackPlayer }: { windows: PlayerStatWindow[]; fallbackPlayer: Player }) {
  const visibleWindows = windows.length
    ? windows
    : [
        { split: "season" as const, label: "Season", stats: fallbackPlayer.seasonStats },
        { split: "projection_ros" as const, label: "ROS Projection", stats: fallbackPlayer.projectedStats },
      ];

  return (
    <section aria-labelledby="player-stats-heading">
      <h3 id="player-stats-heading">Stats</h3>
      <div className="stat-window-list">
        {visibleWindows.map((window) => (
          <div className="stat-window" key={window.split}>
            <span className="player-name">{window.label}</span>
            <div className="stat-chip-grid">
              {primaryStats
                .filter((category) => window.stats[category] !== undefined)
                .slice(0, 6)
                .map((category) => (
                  <span className="stat-chip" key={category}>
                    <span>{category}</span>
                    <strong>{window.stats[category]}</strong>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
