"use client";

import { useState } from "react";
import type { LivePlayerStatus, Player, PlayerDetail, PlayerGameLog, PlayerStatWindow, PlayerValueMetrics } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";

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
  liveStatus,
  variant = "panel",
}: {
  player: PlayerDetail;
  actionInFlight: boolean;
  statusBanner?: PlayerDetailStatusBanner | null;
  onAction: (action: PlayerAction) => void;
  liveStatus?: LivePlayerStatus | null;
  variant?: "panel" | "card";
}) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const tabbed = variant === "card";
  const health = healthBadges[player.status];
  const summary = seasonSummary(player);
  const isLive = Boolean(liveStatus?.live);

  return (
    <>
      <div className="player-detail-header">
        <div className="player-detail-identity">
          <PlayerAvatar mlbPlayerId={player.mlbPlayerId} name={player.name} />
          <div>
            <h3 id="player-detail-heading">{player.name}</h3>
            <span className="player-meta">
              {player.positions.join(", ")} &middot; {player.teamName ?? player.mlbTeam}
              {player.jerseyNumber ? ` · #${player.jerseyNumber}` : ""}
            </span>
          </div>
        </div>
        {isLive ? <span className="live-pill">Live</span> : <span className={`health-badge ${health.className}`}>{health.label}</span>}
      </div>

      <PlayerValueRow value={player.value} />

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
        <PlayerOverview player={player} health={health.label} summary={summary} liveStatus={liveStatus} />
      ) : null}
      {!tabbed || tab === "stats" ? <PlayerStatWindows windows={player.statWindows} fallbackPlayer={player} /> : null}
      {!tabbed || tab === "gamelog" ? <PlayerGameLogRows games={player.gameLog} /> : null}
    </>
  );
}

function PlayerValueRow({ value }: { value: PlayerValueMetrics }) {
  if (value.fanPoints == null && value.rank == null && value.rosteredPercent == null) {
    return null;
  }

  return (
    <div className="detail-value-row">
      <div className="detail-value">
        <span className="detail-value-num">{value.fanPoints ?? "-"}</span>
        <span className="detail-value-label">Fan Points</span>
      </div>
      <div className="detail-value">
        <span className="detail-value-num">{value.rank ?? "-"}</span>
        <span className="detail-value-label">Rank</span>
      </div>
      <div className="detail-value">
        <span className="detail-value-num">{value.rosteredPercent != null ? `${value.rosteredPercent}%` : "-"}</span>
        <span className="detail-value-label">Rostered</span>
      </div>
    </div>
  );
}

function starRating(value: PlayerValueMetrics): number | null {
  if (value.rank == null || value.totalRanked <= 0) {
    return null;
  }
  const percentile = 1 - (value.rank - 1) / value.totalRanked;
  return Math.min(5, Math.max(1, Math.ceil(percentile * 5)));
}

function StarRating({ stars }: { stars: number }) {
  return (
    <div className="star-rating" aria-label={`${stars} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= stars ? "star filled" : "star"} aria-hidden="true">
          {n <= stars ? "★" : "☆"}
        </span>
      ))}
    </div>
  );
}

function formatGameTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// A compact live line, e.g. "1-3, 1 R, 1 HR, 2 RBI" for hitters or
// "5.0 IP, 6 K, 1 ER" for pitchers, from whatever the boxscore has so far.
function liveLineSummary(stats: Record<string, number | string>): string {
  if (stats.IP !== undefined) {
    const parts = [`${stats.IP} IP`];
    if (stats.K !== undefined) parts.push(`${stats.K} K`);
    if (stats.ER !== undefined) parts.push(`${stats.ER} ER`);
    if (Number(stats.W) > 0) parts.push("W");
    if (Number(stats.SV) > 0) parts.push("SV");
    return parts.join(", ");
  }

  const parts: string[] = [];
  if (stats.H !== undefined || stats.AB !== undefined) {
    parts.push(`${stats.H ?? 0}-${stats.AB ?? 0}`);
  }
  if (Number(stats.R) > 0) parts.push(`${stats.R} R`);
  if (Number(stats.HR) > 0) parts.push(`${stats.HR} HR`);
  if (Number(stats.RBI) > 0) parts.push(`${stats.RBI} RBI`);
  if (Number(stats.SB) > 0) parts.push(`${stats.SB} SB`);
  return parts.length ? parts.join(", ") : "Not in yet";
}

function LiveGameCard({ status }: { status: LivePlayerStatus }) {
  return (
    <div className="live-game" aria-label="Live game">
      <div className="live-game-head">
        <span className="live-pill">Live</span>
        <span className="live-state">{status.state}</span>
      </div>
      <div className="live-game-body">
        <span className="live-line">{liveLineSummary(status.stats)}</span>
        <span className="live-points">{status.points ?? 0} pts</span>
      </div>
    </div>
  );
}

function PlayerOverview({
  player,
  health,
  summary,
  liveStatus,
}: {
  player: PlayerDetail;
  health: string;
  summary: string | null;
  liveStatus?: LivePlayerStatus | null;
}) {
  const stars = starRating(player.value);

  return (
    <section aria-labelledby="player-overview-heading">
      <h3 id="player-overview-heading">Overview</h3>

      {liveStatus?.live ? <LiveGameCard status={liveStatus} /> : null}

      {!liveStatus?.live && player.nextGame ? (
        <div className="next-game">
          <span className="next-game-label">Next Game</span>
          <span className="next-game-value">
            {formatGameTime(player.nextGame.date)} {player.nextGame.homeAway === "home" ? "vs" : "@"}{" "}
            {player.nextGame.opponent ?? "TBD"}
          </span>
        </div>
      ) : null}

      {stars != null ? <StarRating stars={stars} /> : null}

      {summary ? <p className="detail-summary">{summary}</p> : null}

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

// The stat categories present across a set of stat maps, in canonical order.
function presentCategories(rows: Array<Record<string, number | string>>) {
  return primaryStats.filter((category) => rows.some((stats) => stats[category] !== undefined));
}

type GameLogColumn = { label: string; render: (stats: Record<string, number | string>) => string };

// A game log shows per-game production. Rate stats (AVG/ERA/WHIP) are omitted
// because the MLB feed reports them season-to-date, not per game; hitters get a
// combined H/AB, pitchers get their line. Only columns with data are shown.
function gameLogColumns(games: PlayerGameLog[]): GameLogColumn[] {
  const present = (key: string) => games.some((game) => game.stats[key] !== undefined);
  const cell = (key: string): GameLogColumn["render"] => (stats) => (stats[key] !== undefined ? String(stats[key]) : "-");
  const pick = (defs: Array<{ label: string; key: string }>) =>
    defs.filter((def) => present(def.key)).map((def) => ({ label: def.label, render: cell(def.key) }));

  const isPitching = present("IP") || present("ER");

  if (isPitching) {
    return pick([
      { label: "IP", key: "IP" },
      { label: "H", key: "HA" },
      { label: "ER", key: "ER" },
      { label: "BB", key: "BB" },
      { label: "K", key: "K" },
      { label: "W", key: "W" },
      { label: "SV", key: "SV" },
    ]);
  }

  const columns: GameLogColumn[] = [];
  if (present("H") || present("AB")) {
    columns.push({ label: "H/AB", render: (stats) => `${stats.H ?? 0}/${stats.AB ?? 0}` });
  }
  return columns.concat(
    pick([
      { label: "R", key: "R" },
      { label: "HR", key: "HR" },
      { label: "RBI", key: "RBI" },
      { label: "SB", key: "SB" },
    ]),
  );
}

function PlayerGameLogRows({ games }: { games: PlayerGameLog[] }) {
  const columns = gameLogColumns(games);

  return (
    <section aria-labelledby="player-game-log-heading">
      <h3 id="player-game-log-heading">Game Log</h3>
      {games.length ? (
        <div className="stat-table-wrap">
          <table className="stat-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                {columns.map((column) => (
                  <th scope="col" key={column.label}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id}>
                  <th scope="row">{new Date(game.date).toLocaleDateString()}</th>
                  {columns.map((column) => (
                    <td key={column.label}>{column.render(game.stats)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">No recent game log available.</div>
      )}
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
  const categories = presentCategories(visibleWindows.map((window) => window.stats));

  return (
    <section aria-labelledby="player-stats-heading">
      <h3 id="player-stats-heading">Stats</h3>
      <div className="stat-table-wrap">
        <table className="stat-table">
          <thead>
            <tr>
              <th scope="col">Split</th>
              {categories.map((category) => (
                <th scope="col" key={category}>
                  {category}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleWindows.map((window) => (
              <tr key={window.split}>
                <th scope="row">{window.label}</th>
                {categories.map((category) => (
                  <td key={category}>{window.stats[category] ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
