"use client";

import type { Player, PlayerDetail, PlayerGameLog, PlayerStatWindow } from "@/lib/fantasy/types";

export type PlayerAction = "add" | "drop" | "move-to-il" | "move-to-na";

export type PlayerDetailStatusBanner = { kind: "good" | "bad"; message: string };

const primaryStats = ["R", "HR", "RBI", "SB", "AVG", "W", "SV", "K", "ERA", "WHIP"];

/**
 * Shared player-detail body (header, management actions, stat windows, game
 * log, and news) rendered both in the Players-tab side panel and the Team-tab
 * detail modal.
 */
export function PlayerDetailView({
  player,
  actionInFlight,
  statusBanner,
  onAction,
}: {
  player: PlayerDetail;
  actionInFlight: boolean;
  statusBanner?: PlayerDetailStatusBanner | null;
  onAction: (action: PlayerAction) => void;
}) {
  return (
    <>
      <div className="player-detail-header">
        <div>
          <h3 id="player-detail-heading">{player.name}</h3>
          <span className="player-meta">
            {player.mlbTeam} - {player.positions.join(", ")} - {player.availability}
          </span>
        </div>
        <span className="pill">{player.status}</span>
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
    </>
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
