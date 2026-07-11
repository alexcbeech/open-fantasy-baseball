"use client";

import { useLiveMatchup } from "./use-live-matchup";

type LiveScoreRowProps = {
  teamId: string;
  teamName: string;
  opponentName: string;
  periodLabel: string;
  initialUserScore: number;
  initialOpponentScore: number;
  /** Home team cards show the score-share bar under the row; the team hero doesn't. */
  showShareBar?: boolean;
};

/**
 * A matchup score row that upgrades itself with live values: it renders the
 * stored (nightly) scores immediately, then polls the live recalculation and
 * swaps in today's numbers wherever games have been played — with a LIVE pill
 * while any game is still in progress. Used by the home team cards and the
 * team page hero so scores match the Matchup tab everywhere.
 */
export function LiveScoreRow({
  teamId,
  teamName,
  opponentName,
  periodLabel,
  initialUserScore,
  initialOpponentScore,
  showShareBar = false,
}: LiveScoreRowProps) {
  const update = useLiveMatchup(teamId);
  const hasToday = Boolean(update?.hasTodayStats);
  const userScore = hasToday ? update!.userScore : initialUserScore;
  const opponentScore = hasToday ? update!.opponentScore : initialOpponentScore;
  const total = userScore + opponentScore;
  const share = total > 0 ? Math.round((userScore / total) * 100) : 50;

  return (
    <>
      <div className="score-row" aria-label={`${teamName} score against ${opponentName}`}>
        <div className="score-team">
          <span className="score-name">{teamName}</span>
          <span className="score-value">{userScore}</span>
        </div>
        <span className="versus">{update?.live ? <span className="live-pill">Live</span> : periodLabel}</span>
        <div className="score-team">
          <span className="score-name">{opponentName}</span>
          <span className="score-value">{opponentScore}</span>
        </div>
      </div>
      {showShareBar ? (
        <div className="progress" aria-label={`${share}% score share`}>
          <span style={{ width: `${share}%` }} />
        </div>
      ) : null}
    </>
  );
}
