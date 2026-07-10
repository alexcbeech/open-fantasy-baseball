"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TradeSummary } from "@/lib/fantasy/trade-types";
import type { LineupPlayer } from "@/lib/fantasy/types";

type TradesPanelProps = {
  leagueId: string;
  viewerTeamId: string;
};

const statusLabels: Record<TradeSummary["status"], string> = {
  proposed: "Awaiting response",
  accepted: "Under league review",
  processed: "Processed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  vetoed: "Vetoed by commissioner",
  voted_down: "Rejected by league vote",
  failed: "Failed roster check",
};

function playerList(players: TradeSummary["offered"]): string {
  return players.map((player) => `${player.name} (${player.positions.join("/")})`).join(", ");
}

/**
 * League-wide trade feed: every member sees each offer move through review,
 * the recipient responds (with drops when the deal overflows their roster),
 * outside teams vote against, and the commissioner can veto until processed.
 */
export function TradesPanel({ leagueId, viewerTeamId }: TradesPanelProps) {
  const router = useRouter();
  const [trades, setTrades] = useState<TradeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTradeId, setBusyTradeId] = useState<string | null>(null);
  const [dropPickerTradeId, setDropPickerTradeId] = useState<string | null>(null);
  const [dropChoices, setDropChoices] = useState<Set<string>>(new Set());
  const [myLineup, setMyLineup] = useState<LineupPlayer[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/leagues/${leagueId}/trades`);
      const result = (await response.json()) as { trades?: TradeSummary[]; error?: string };

      if (!response.ok || !result.trades) {
        setError(result.error ?? "Trades could not be loaded.");
        return;
      }

      setTrades(result.trades);
    } catch {
      setError("Trades could not be loaded.");
    }
  }, [leagueId]);

  useEffect(() => {
    refresh();
    // Re-fetch when a sibling component (the propose sheet) creates a trade.
    window.addEventListener("ofb:trades-changed", refresh);
    return () => window.removeEventListener("ofb:trades-changed", refresh);
  }, [refresh]);

  async function act(tradeId: string, action: "accept" | "decline" | "withdraw" | "vote" | "veto", dropPlayerIds?: string[]) {
    setBusyTradeId(tradeId);
    setError(null);

    try {
      const response = await fetch(`/api/v1/leagues/${leagueId}/trades/${tradeId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, dropPlayerIds }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        // An accept that overflows the roster needs drops: open the picker.
        if (action === "accept" && response.status === 409 && result.error?.includes("more players")) {
          await openDropPicker(tradeId);
          setError(result.error);
          return;
        }

        setError(result.error ?? "The trade action failed.");
        return;
      }

      setDropPickerTradeId(null);
      setDropChoices(new Set());
      await refresh();
      // Processed trades change rosters/lineups; refresh the page data too.
      router.refresh();
    } catch {
      setError("The trade action failed.");
    } finally {
      setBusyTradeId(null);
    }
  }

  async function openDropPicker(tradeId: string) {
    setDropPickerTradeId(tradeId);
    setDropChoices(new Set());

    if (!myLineup) {
      try {
        const response = await fetch(`/api/v1/teams/${viewerTeamId}/lineup`);
        const result = (await response.json()) as { lineup?: LineupPlayer[] };

        if (response.ok && result.lineup) {
          setMyLineup(result.lineup);
        }
      } catch {
        // The picker just renders empty; the accept retry will explain.
      }
    }
  }

  function toggleDrop(playerId: string) {
    setDropChoices((current) => {
      const next = new Set(current);

      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }

      return next;
    });
  }

  if (trades !== null && trades.length === 0 && !error) {
    return null;
  }

  return (
    <section className="panel" aria-labelledby="trades-heading">
      <h2 id="trades-heading">Trades</h2>
      {error ? (
        <div className="status-banner bad" role="alert">
          {error}
        </div>
      ) : null}
      {trades === null ? <div className="empty-state">Loading trades&hellip;</div> : null}

      <div className="trade-list">
        {(trades ?? []).map((trade) => {
          const busy = busyTradeId === trade.id;
          const requestedIds = new Set(trade.requested.map((player) => player.playerId));

          return (
            <article className="trade-card" key={trade.id}>
              <div className="trade-card-header">
                <strong>
                  {trade.fromTeam.name} &harr; {trade.toTeam.name}
                </strong>
                <span className={`trade-status trade-status-${trade.status}`}>{statusLabels[trade.status]}</span>
              </div>

              <p className="trade-line">
                <span className="trade-line-label">{trade.toTeam.name} gets:</span> {playerList(trade.offered)}
              </p>
              <p className="trade-line">
                <span className="trade-line-label">{trade.fromTeam.name} gets:</span> {playerList(trade.requested)}
              </p>
              {trade.fromDrops.length ? (
                <p className="trade-line">
                  <span className="trade-line-label">{trade.fromTeam.name} drops:</span> {playerList(trade.fromDrops)}
                </p>
              ) : null}
              {trade.toDrops.length ? (
                <p className="trade-line">
                  <span className="trade-line-label">{trade.toTeam.name} drops:</span> {playerList(trade.toDrops)}
                </p>
              ) : null}

              {trade.status === "accepted" ? (
                <p className="trade-line subtle">
                  {trade.reviewEndsAt ? `Review ends ${new Date(trade.reviewEndsAt).toLocaleString()}.` : ""}
                  {trade.votesNeeded !== null
                    ? ` Votes against: ${trade.votesAgainst}/${trade.votesNeeded}.`
                    : ""}
                </p>
              ) : null}

              {dropPickerTradeId === trade.id && trade.viewer.canRespond ? (
                <div className="trade-drop-picker">
                  <p className="move-sheet-subtitle">Select players to drop so the deal fits your roster:</p>
                  {(myLineup ?? [])
                    .filter((entry) => !requestedIds.has(entry.player.id))
                    .map((entry) => (
                      <label className="trade-pick-row" key={entry.player.id}>
                        <input
                          type="checkbox"
                          checked={dropChoices.has(entry.player.id)}
                          onChange={() => toggleDrop(entry.player.id)}
                        />
                        <span className="player-main">
                          <span className="player-name">{entry.player.name}</span>
                          <span className="player-meta">
                            {entry.player.mlbTeam} &ndash; {entry.player.positions.join(", ")}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              ) : null}

              <div className="trade-actions">
                {trade.viewer.canRespond ? (
                  <>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => act(trade.id, "accept", dropPickerTradeId === trade.id ? [...dropChoices] : undefined)}
                    >
                      Accept
                    </button>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => act(trade.id, "decline")}>
                      Decline
                    </button>
                  </>
                ) : null}
                {trade.viewer.canWithdraw ? (
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => act(trade.id, "withdraw")}>
                    Withdraw
                  </button>
                ) : null}
                {trade.viewer.canVote ? (
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => act(trade.id, "vote")}>
                    Vote against
                  </button>
                ) : null}
                {trade.viewer.hasVoted && trade.status === "accepted" ? (
                  <span className="trade-line subtle">You voted against this trade.</span>
                ) : null}
                {trade.viewer.canVeto ? (
                  <button className="secondary-button trade-veto" type="button" disabled={busy} onClick={() => act(trade.id, "veto")}>
                    Veto
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
