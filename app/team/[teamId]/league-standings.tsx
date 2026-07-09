"use client";

import { useState } from "react";
import type { LeagueStanding } from "@/lib/fantasy/types";
import { TeamLineupSheet } from "./team-lineup-sheet";

type LeagueStandingsProps = {
  standings: LeagueStanding[];
};

/** Standings table where tapping a team opens their current lineup. */
export function LeagueStandings({ standings }: LeagueStandingsProps) {
  const [viewing, setViewing] = useState<LeagueStanding | null>(null);

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
        <TeamLineupSheet teamId={viewing.teamId} teamName={viewing.teamName} onClose={() => setViewing(null)} />
      ) : null}
    </>
  );
}
