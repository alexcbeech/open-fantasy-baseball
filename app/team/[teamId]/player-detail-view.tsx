"use client";

import { useState } from "react";
import type { Player, PlayerDetail, PlayerGameLog, PlayerStatWindow } from "@/lib/fantasy/types";

export type PlayerAction = "add" | "drop" | "move-to-il" | "move-to-na";

export type PlayerDetailStatusBanner = { kind: "good" | "bad"; message: string };

type DetailTab = "overview" | "gamelog" | "stats";

const primaryStats = ["R", "HR", "RBI", "SB", "AVG", "W", "SV", "K", "ERA", "WHIP"];
const pitcherPositions = ["SP", "RP", "P"];

const healthBadges: Record<Player["status"], { label: string; className: string }> = {
  active: { label: "Healthy", className: "health-active" },
  "day-to-day": { label: "Day-to-Day", className: "health-dtd" },
  injured: { label: "Injured", className: "health-injured" },
  minors: { label: "Minors", className: "health-minors" },
};

function availabilityLabel(availability: Player["availability"]) {
  return availability === "rostered" ? "Rostered" : "Free agent";
}

function hasStat(stats: Record<string, number | string>, key: string) {
  const value = stats[key];
  return value !== undefined && value !== null && value !== "";
}

/**
 * A plain-language season line built from whatever season stats the player has,
 * branching on hitter vs. pitcher — the OFB take on Yahoo's overview blurb.
 */
function seasonSummary(player: PlayerDetail): string | null {
  const stats = player.seasonStats ?? {};
  const isPitcher = hasStat(stats, "ERA") || hasStat(stats, "WHIP") || player.positions.some((position) => pitcherPositions.includes(position));

  if (isPitcher) {
    const rates: string[] = [];
    if (hasStat(stats, "ERA")) rates.push(`a ${stats.ERA} ERA`);
    if (hasStat(stats, "WHIP")) rates.push(`a ${stats.WHIP} WHIP`);

    const counting: string[] = [];
    if (hasStat(stats, "W")) counting.push(`${stats.W} ${Number(stats.W) === 1 ? "win" : "wins"}`);
    if (hasStat(stats, "SV")) counting.push(`${stats.SV} ${Number(stats.SV) === 1 ? "save" : "saves"}`);
    if (hasStat(stats, "K")) counting.push(`${stats.K} strikeouts`);

    if (!rates.length && !counting.length) return null;
    const lead = rates.length ? `has ${rates.join(" and ")}` : "has";
    return `${player.name} ${lead}${counting.length ? ` with ${counting.join(", ")}` : ""} this season.`;
  }

  const counting: string[] = [];
  if (hasStat(stats, "HR")) counting.push(`${stats.HR} HR`);
  if (hasStat(stats, "RBI")) counting.push(`${stats.RBI} RBI`);
  if (hasStat(stats, "R")) counting.push(`${stats.R} R`);
  if (hasStat(stats, "SB")) counting.push(`${stats.SB} SB`);

  const lead = hasStat(stats, "AVG") ? `is hitting ${stats.AVG}` : "is producing";
  if (lead === "is producing" && !counting.length) return null;
  return `${player.name} ${lead}${counting.length ? ` with ${counting.join(", ")}` : ""} this season.`;
}

/**
 * Shared player-detail body (header, management actions, overview, stat
 * windows, game log, and news). The Players-tab side panel renders every
 * section stacked (variant "panel"); the Team-tab modal renders a tabbed,
 * Yahoo-style card (variant "card").
 */
export function PlayerDetailView({
  player,
  actionInFlight,
  statusBanner,
  onAction,
  variant = "panel",
}: {
  player: PlayerDetail;
  actionInFlight: boolean;
  statusBanner?: PlayerDetailStatusBanner | null;
  onAction: (action: PlayerAction) => void;
  variant?: "panel" | "card";
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const tabbed = variant === "card";
  const health = healthBadges[player.status];
  const summary = seasonSummary(player);

  return (
    <>
      <div className="player-detail-header">
        <div>
          <h3 id="player-detail-heading">{player.name}</h3>
          <span className="player-meta">
            {player.positions.join(", ")} &middot; {player.mlbTeam} &middot; {availabilityLabel(player.availability)}
          </span>
        </div>
        <span className={`health-badge ${health.className}`}>{health.label}</span>
      </div>

      {statusBanner ? <div className={`status-banner ${statusBanner.kind}`}>{statusBanner.message}</div> : null}

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

      {tabbed ? (
        <div className="detail-tabs" role="tablist" aria-label="Player detail sections">
          <button className={tab === "overview" ? "detail-tab active" : "detail-tab"} type="button" role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button className={tab === "gamelog" ? "detail-tab active" : "detail-tab"} type="button" role="tab" aria-selected={tab === "gamelog"} onClick={() => setTab("gamelog")}>
            Game Log
          </button>
          <button className={tab === "stats" ? "detail-tab active" : "detail-tab"} type="button" role="tab" aria-selected={tab === "stats"} onClick={() => setTab("stats")}>
            Stats
          </button>
        </div>
      ) : null}

      {!tabbed || tab === "overview" ? (
        <PlayerOverview player={player} health={health.label} summary={summary} />
      ) : null}
      {!tabbed || tab === "stats" ? <PlayerStatWindows windows={player.statWindows} fallbackPlayer={player} /> : null}
      {!tabbed || tab === "gamelog" ? <PlayerGameLogRows games={player.gameLog} /> : null}
    </>
  );
}

function PlayerOverview({ player, health, summary }: { player: PlayerDetail; health: string; summary: string | null }) {
  return (
    <section aria-labelledby="player-overview-heading">
      <h3 id="player-overview-heading">Overview</h3>
      <div className="metric-grid">
        <div className="metric">
          <span className="metric-label">Availability</span>
          <span className="metric-value">{availabilityLabel(player.availability)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{health}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Positions</span>
          <span className="metric-value">{player.positions.join(", ")}</span>
        </div>
      </div>

      {summary ? <p className="detail-summary">{summary}</p> : null}

      <h4 className="detail-subheading">Latest News</h4>
      <div className="setting-list">
        {player.news.length ? (
          player.news.slice(0, 3).map((item) => (
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
