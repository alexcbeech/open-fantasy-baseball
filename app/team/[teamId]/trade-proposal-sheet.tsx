"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { tradeIssues, type TradeRosterPlayer } from "@/lib/fantasy/trade-evaluation";
import type { LineupPlayer } from "@/lib/fantasy/types";
import { PlayerAvatar } from "./player-avatar";

type TradeProposalSheetProps = {
  leagueId: string;
  viewerTeamId: string;
  targetTeamId: string;
  targetTeamName: string;
  onClose: () => void;
  onProposed: () => void;
};

function toRosterPlayers(lineup: LineupPlayer[]): TradeRosterPlayer[] {
  return lineup.map((entry) => ({ playerId: entry.player.id, positions: entry.player.positions }));
}

/**
 * Build a trade offer: pick players to receive from the other team and players
 * to send from yours. Fit is checked live with the same rule the server
 * enforces — when your side would overflow, a drop picker appears; the other
 * side's overflow is resolved by drops they choose when accepting.
 */
export function TradeProposalSheet({
  leagueId,
  viewerTeamId,
  targetTeamId,
  targetTeamName,
  onClose,
  onProposed,
}: TradeProposalSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock();
  const [theirLineup, setTheirLineup] = useState<LineupPlayer[] | null>(null);
  const [myLineup, setMyLineup] = useState<LineupPlayer[] | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [offered, setOffered] = useState<Set<string>>(new Set());
  const [drops, setDrops] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const load = async (teamId: string, apply: (lineup: LineupPlayer[]) => void) => {
      try {
        const response = await fetch(`/api/v1/teams/${teamId}/lineup`);
        const result = (await response.json()) as { lineup?: LineupPlayer[]; error?: string };

        if (active && response.ok && result.lineup) {
          apply(result.lineup);
        } else if (active) {
          setError(result.error ?? "Rosters could not be loaded.");
        }
      } catch {
        if (active) {
          setError("Rosters could not be loaded.");
        }
      }
    };

    load(targetTeamId, setTheirLineup);
    load(viewerTeamId, setMyLineup);
    return () => {
      active = false;
    };
  }, [targetTeamId, viewerTeamId]);

  const issues = useMemo(() => {
    if (!theirLineup || !myLineup || (!requested.size && !offered.size)) {
      return [];
    }

    return tradeIssues(
      {
        fromRoster: toRosterPlayers(myLineup),
        toRoster: toRosterPlayers(theirLineup),
        offeredPlayerIds: [...offered],
        requestedPlayerIds: [...requested],
        fromDropPlayerIds: [...drops],
        toDropPlayerIds: [],
      },
      defaultRosterSlots,
    );
  }, [theirLineup, myLineup, requested, offered, drops]);

  const myOverflow = issues.some((issue) => issue.includes("proposing team with more players"));
  const theirOverflow = issues.some((issue) => issue.includes("receiving team with more players"));
  const blockingIssues = issues.filter((issue) => !issue.includes("receiving team with more players"));
  const canSubmit = requested.size > 0 && offered.size > 0 && blockingIssues.length === 0 && !submitting;

  const toggle = (set: Set<string>, apply: (next: Set<string>) => void, id: string) => {
    const next = new Set(set);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    apply(next);
  };

  async function submit() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/leagues/${leagueId}/trades`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromTeamId: viewerTeamId,
          toTeamId: targetTeamId,
          offeredPlayerIds: [...offered],
          requestedPlayerIds: [...requested],
          fromDropPlayerIds: [...drops],
        }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "The trade offer could not be sent.");
        return;
      }

      onProposed();
    } catch {
      setError("The trade offer could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  const renderPickList = (
    lineup: LineupPlayer[],
    selected: Set<string>,
    onToggle: (id: string) => void,
    excludeIds?: Set<string>,
  ) =>
    lineup
      .filter((entry) => !excludeIds?.has(entry.player.id))
      .map((entry) => (
        <label className="trade-pick-row" key={entry.player.id}>
          <input
            type="checkbox"
            checked={selected.has(entry.player.id)}
            onChange={() => onToggle(entry.player.id)}
          />
          <PlayerAvatar mlbPlayerId={entry.player.mlbPlayerId} name={entry.player.name} />
          <span className="player-main">
            <span className="player-name">{entry.player.name}</span>
            <span className="player-meta">
              {entry.player.mlbTeam} &ndash; {entry.player.positions.join(", ")}
            </span>
          </span>
        </label>
      ));

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-sheet-title"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet-grabber" aria-hidden="true" />
        <div className="move-sheet-header">
          <h2 id="trade-sheet-title">Trade with {targetTeamName}</h2>
          <button className="move-sheet-close" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>

        {error ? (
          <div className="status-banner bad" role="alert">
            {error}
          </div>
        ) : null}

        {!theirLineup || !myLineup ? (
          <div className="empty-state">Loading rosters&hellip;</div>
        ) : (
          <>
            <h3 className="trade-section-heading">You receive ({requested.size})</h3>
            <div className="trade-pick-list">{renderPickList(theirLineup, requested, (id) => toggle(requested, setRequested, id))}</div>

            <h3 className="trade-section-heading">You send ({offered.size})</h3>
            <div className="trade-pick-list">
              {renderPickList(myLineup, offered, (id) => toggle(offered, setOffered, id), drops)}
            </div>

            {myOverflow || drops.size > 0 ? (
              <>
                <h3 className="trade-section-heading">You drop ({drops.size})</h3>
                <p className="move-sheet-subtitle">
                  This deal brings back more players than your roster holds. Drop players to make room.
                </p>
                <div className="trade-pick-list">
                  {renderPickList(myLineup, drops, (id) => toggle(drops, setDrops, id), offered)}
                </div>
              </>
            ) : null}

            {theirOverflow ? (
              <p className="move-sheet-subtitle">
                {targetTeamName} will need to drop players to accept this deal.
              </p>
            ) : null}
            {blockingIssues.length ? <p className="move-sheet-subtitle trade-issue">{blockingIssues[0]}</p> : null}

            <button className="primary-button" type="button" disabled={!canSubmit} onClick={submit}>
              {submitting ? "Sending offer..." : "Send Trade Offer"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
