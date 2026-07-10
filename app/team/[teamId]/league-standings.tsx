"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeagueStanding } from "@/lib/fantasy/types";
import { TeamLineupSheet } from "./team-lineup-sheet";
import { TradeProposalSheet } from "./trade-proposal-sheet";

type LeagueStandingsProps = {
  standings: LeagueStanding[];
  leagueId: string;
  /** The team page being viewed; trades are proposed from this team. */
  viewerTeamId: string;
  /** Whether the viewer manages this page's team (enables proposing trades). */
  canTrade: boolean;
};

/** Standings table where tapping a team opens their current lineup. */
export function LeagueStandings({ standings, leagueId, viewerTeamId, canTrade }: LeagueStandingsProps) {
  const router = useRouter();
  const [viewing, setViewing] = useState<LeagueStanding | null>(null);
  const [trading, setTrading] = useState<LeagueStanding | null>(null);

  return (
    <>
      <table className="standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Record</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.teamId}>
              <td>{row.rank}</td>
              <td>
                <button
                  className="standings-team-button"
                  type="button"
                  onClick={() => setViewing(row)}
                  aria-label={`View ${row.teamName}'s current lineup`}
                >
                  <span className="player-name">{row.teamName}</span>
                  <span className="player-meta">{row.managerName}</span>
                </button>
              </td>
              <td>{row.record}</td>
              <td>{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {viewing ? (
        <TeamLineupSheet
          teamId={viewing.teamId}
          teamName={viewing.teamName}
          onClose={() => setViewing(null)}
          onProposeTrade={
            canTrade && viewing.teamId !== viewerTeamId
              ? () => {
                  setTrading(viewing);
                  setViewing(null);
                }
              : undefined
          }
        />
      ) : null}

      {trading ? (
        <TradeProposalSheet
          leagueId={leagueId}
          viewerTeamId={viewerTeamId}
          targetTeamId={trading.teamId}
          targetTeamName={trading.teamName}
          onClose={() => setTrading(null)}
          onProposed={() => {
            setTrading(null);
            // The trades panel is a sibling client component; nudge it.
            window.dispatchEvent(new Event("ofb:trades-changed"));
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
