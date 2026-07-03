"use client";

import { useMemo, useState } from "react";
import { readPlayerStat } from "@/lib/fantasy/scoring";
import type { Player } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";
import { PlayerDetailSheet } from "./player-detail-sheet";
import { PositionBadge } from "./position-badge";

type PlayersBrowserProps = {
  teamId: string;
  players: Player[];
};

type SortMode = "projected-hr" | "season-r" | "availability" | "name";

function numericStat(player: Player, category: string, projection = false) {
  const value = readPlayerStat(player, category, projection);
  return typeof value === "number" ? value : Number.parseFloat(value.toString()) || 0;
}

export function PlayersBrowser({ teamId, players }: PlayersBrowserProps) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("projected-hr");
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = players.filter((player) => {
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
  }, [players, query, sortMode]);

  return (
    <>
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
              <button
                className="row players-row"
                type="button"
                key={player.id}
                onClick={() => setDetailPlayerId(player.id)}
                aria-label={`View ${player.name} details`}
              >
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

      {detailPlayerId ? (
        <PlayerDetailSheet playerId={detailPlayerId} teamId={teamId} onClose={() => setDetailPlayerId(null)} />
      ) : null}
    </>
  );
}
