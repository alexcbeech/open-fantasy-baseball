"use client";

import { useEffect, useMemo, useState } from "react";
import { formatGameLine, rowPoints } from "@/lib/fantasy/player-view";
import type { Player, RosterSlot } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";
import { PlayerDetailSheet } from "./player-detail-sheet";
import { PositionBadge } from "./position-badge";

type PlayersBrowserProps = {
  teamId: string;
  players: Player[];
};

type SortMode = "projected" | "season" | "name";
type AvailabilityFilter = "all" | "available" | "rostered";

// Position filter chips, in the order Yahoo lists them across the top strip.
const positionFilters: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const availabilityFilters: { key: AvailabilityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "rostered", label: "Rostered" },
];

export function PlayersBrowser({ teamId, players }: PlayersBrowserProps) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("projected");
  const [position, setPosition] = useState<RosterSlot | "ALL">("ALL");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, { state: string | null; points: number }>>({});

  // Overlay live in-game points/inning on any listed player whose game is in
  // progress; bounded by the number of live games, so it is cheap to poll.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/players/live`);
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
  }, []);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = players.filter((player) => {
      if (position !== "ALL" && !player.positions.includes(position)) {
        return false;
      }
      if (availability === "available" && player.availability === "rostered") {
        return false;
      }
      if (availability === "rostered" && player.availability !== "rostered") {
        return false;
      }
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
        case "projected":
          return rowPoints(right).projPts - rowPoints(left).projPts;
        case "season":
          return rowPoints(right).seasonPts - rowPoints(left).seasonPts;
        case "name":
          return left.name.localeCompare(right.name);
      }
    });
  }, [players, query, sortMode, position, availability]);

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
            <option value="projected">Sort: Projected</option>
            <option value="season">Sort: Season Pts</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        <div className="filter-chips" role="group" aria-label="Filter by availability">
          {availabilityFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={availability === filter.key ? "filter-chip active" : "filter-chip"}
              aria-pressed={availability === filter.key}
              onClick={() => setAvailability(filter.key)}
            >
              {filter.label}
            </button>
          ))}
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

        <div className="lineup-group-label lineup-list-legend">
          <span>{filteredPlayers.length} Players</span>
          <span className="lineup-col-heads" aria-hidden="true">
            <span>Pts</span>
            <span>Proj</span>
          </span>
        </div>

        <div className="player-list" aria-live="polite">
          {filteredPlayers.length ? (
            filteredPlayers.map((player) => {
              const { seasonPts, projPts } = rowPoints(player);
              const liveEntry = live[player.id];
              const boldPts = liveEntry ? liveEntry.points : seasonPts;
              const injured = player.status === "injured" || player.status === "day-to-day";
              const gameLine = liveEntry?.state ?? formatGameLine(player.nextGame, player.status);
              const gameClass = liveEntry ? "player-game is-live" : injured ? "player-game injury" : "player-game";

              return (
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
                      {player.mlbTeam} &ndash; {player.positions.join(", ")}
                    </span>
                    <span className={gameClass}>{gameLine}</span>
                  </span>
                  <span className="player-points" aria-hidden="true">
                    <span className={liveEntry ? "points-live is-live" : "points-live"}>{boldPts}</span>
                    <span className="points-proj">{projPts}</span>
                  </span>
                </button>
              );
            })
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
