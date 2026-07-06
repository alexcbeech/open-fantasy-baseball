"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatGameLine, rowPoints } from "@/lib/fantasy/player-view";
import type { Player, RosterSlot } from "@/lib/fantasy/types";
import { PlayerDetailSheet } from "./player-detail-sheet";

type PlayersBrowserProps = {
  teamId: string;
  players: Player[];
};

type AvailabilityFilter = "all" | "available" | "rostered";

// Position filter chips, in the order Yahoo lists them across the top strip.
const positionFilters: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP"];
const availabilityFilters: { key: AvailabilityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "rostered", label: "Rostered" },
];

// The league's ten scoring categories, hitting first, Yahoo-style.
const statCategories = ["R", "HR", "RBI", "SB", "AVG", "W", "SV", "K", "ERA", "WHIP"] as const;

type SortKey = "player" | "team" | "pos" | "elig" | "fanPts" | "rosPct" | (typeof statCategories)[number];

type ColumnDef = {
  key: SortKey;
  label: string;
  /** Numeric columns default to descending on first click; text to ascending. */
  numeric: boolean;
  sortValue: (player: Player) => string | number | null;
};

function statValue(player: Player, category: string): number | null {
  const value = player.seasonStats?.[category];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

const columns: ColumnDef[] = [
  { key: "player", label: "Player", numeric: false, sortValue: (player) => player.name },
  { key: "team", label: "Team", numeric: false, sortValue: (player) => player.mlbTeam },
  { key: "pos", label: "Pos", numeric: false, sortValue: (player) => player.positions[0] ?? "" },
  { key: "elig", label: "Eligible", numeric: false, sortValue: (player) => player.positions.join(", ") },
  { key: "fanPts", label: "Fan Pts", numeric: true, sortValue: (player) => rowPoints(player).seasonPts },
  { key: "rosPct", label: "Ros %", numeric: true, sortValue: (player) => player.rosteredPercent ?? null },
  ...statCategories.map((category) => ({
    key: category as SortKey,
    label: category,
    numeric: true,
    sortValue: (player: Player) => statValue(player, category),
  })),
];

export function PlayersBrowser({ teamId, players }: PlayersBrowserProps) {
  const router = useRouter();
  const [playerList, setPlayerList] = useState(players);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<RosterSlot | "ALL">("ALL");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("fanPts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailPlayerId, setDetailPlayerId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, { state: string | null; points: number }>>({});

  // Resync with the server list after a router.refresh() (e.g. post add/drop).
  useEffect(() => {
    setPlayerList(players);
  }, [players]);

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

  const sortColumn = columns.find((column) => column.key === sortKey) ?? columns[4];

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = playerList.filter((player) => {
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

    const direction = sortDir === "asc" ? 1 : -1;
    return matches.toSorted((left, right) => {
      const leftValue = sortColumn.sortValue(left);
      const rightValue = sortColumn.sortValue(right);

      // Players missing the stat always sink to the bottom, either direction.
      if (leftValue === null && rightValue === null) return left.name.localeCompare(right.name);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;

      if (typeof leftValue === "string" || typeof rightValue === "string") {
        return direction * String(leftValue).localeCompare(String(rightValue));
      }
      return direction * (leftValue - rightValue) || left.name.localeCompare(right.name);
    });
  }, [playerList, query, position, availability, sortColumn, sortDir]);

  function toggleSort(column: ColumnDef) {
    if (column.key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(column.key);
    setSortDir(column.numeric ? "desc" : "asc");
  }

  function displayStat(player: Player, category: string): string {
    const value = player.seasonStats?.[category];
    if (value === undefined || value === null || value === "") {
      return "-";
    }
    return String(value);
  }

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

        <div className="players-table-meta">{filteredPlayers.length} players</div>

        <div className="players-table-wrap" aria-live="polite">
          <table className="players-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.key === "player" ? "players-col-player" : undefined}
                    aria-sort={column.key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      className={column.key === sortKey ? "players-sort active" : "players-sort"}
                      onClick={() => toggleSort(column)}
                      aria-label={`Sort by ${column.label}`}
                    >
                      {column.label}
                      <span className="players-sort-arrow" aria-hidden="true">
                        {column.key === sortKey ? (sortDir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.length ? (
                filteredPlayers.map((player) => {
                  const liveEntry = live[player.id];
                  const injured = player.status === "injured" || player.status === "day-to-day";
                  const gameLine = liveEntry?.state ?? formatGameLine(player.nextGame, player.status);
                  const gameClass = liveEntry ? "player-game is-live" : injured ? "player-game injury" : "player-game";

                  return (
                    <tr key={player.id} className={player.availability === "rostered" ? "is-rostered" : undefined}>
                      <td className="players-col-player">
                        <button
                          className="players-name-button"
                          type="button"
                          onClick={() => setDetailPlayerId(player.id)}
                          aria-label={`View ${player.name} details`}
                        >
                          <span className="player-name">{player.name}</span>
                          <span className={gameClass}>{gameLine}</span>
                        </button>
                      </td>
                      <td>{player.mlbTeam}</td>
                      <td>{player.positions[0] ?? "-"}</td>
                      <td>{player.positions.join(", ")}</td>
                      <td className="players-num">
                        {liveEntry ? (
                          <span className="points-live is-live">{liveEntry.points}</span>
                        ) : (
                          rowPoints(player).seasonPts
                        )}
                      </td>
                      <td className="players-num">{player.rosteredPercent != null ? `${player.rosteredPercent}%` : "-"}</td>
                      {statCategories.map((category) => (
                        <td className="players-num" key={category}>
                          {displayStat(player, category)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={columns.length}>
                    <div className="empty-state">No players match that search.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailPlayerId ? (
        <PlayerDetailSheet
          playerId={detailPlayerId}
          teamId={teamId}
          onClose={() => setDetailPlayerId(null)}
          onRosterChange={(updated) => {
            // Reflect the transaction immediately: an added player flips to
            // rostered (dropping out of the Available list) and vice versa.
            setPlayerList((current) =>
              current.map((candidate) =>
                candidate.id === updated.id ? { ...candidate, availability: updated.availability, status: updated.status } : candidate,
              ),
            );
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
