"use client";

import { useLiveMatchup } from "@/app/use-live-matchup";
import { rowPoints } from "@/lib/fantasy/player-view";
import type { LineupPlayer, MatchupDetails, RosterSlot } from "@/lib/fantasy/types";

// Order starters the way the lineup is displayed so the two rosters line up
// position-by-position; reserves are excluded from the head-to-head compare.
const starterOrder: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "P"];

function orderedStarters(lineup: LineupPlayer[]): LineupPlayer[] {
  return lineup
    .filter((entry) => starterOrder.includes(entry.slot))
    .toSorted((left, right) => starterOrder.indexOf(left.slot) - starterOrder.indexOf(right.slot));
}

/**
 * The Matchup tab. Server-rendered with the stored (nightly) category battle,
 * then polls for the live recalculation: whenever today's games have produced
 * stats (in progress or already final) the category values, categories-won
 * score, and each starter's points reflect them, with a LIVE pill while any
 * game is still going. When nobody has played today it shows stored values.
 */
export function LiveMatchup({ matchup, teamId }: { matchup: MatchupDetails; teamId: string }) {
  const update = useLiveMatchup(teamId);

  const isLive = Boolean(update?.live);
  const hasToday = Boolean(update?.hasTodayStats);
  const userScore = hasToday ? update!.userScore : matchup.userScore;
  const opponentScore = hasToday ? update!.opponentScore : matchup.opponentScore;
  const categoryScores = hasToday ? update!.categoryScores : matchup.categoryScores;
  const livePoints = update?.livePoints ?? {};

  const userStarters = orderedStarters(matchup.userLineup);
  const opponentStarters = orderedStarters(matchup.opponentLineup);
  const rowCount = Math.max(userStarters.length, opponentStarters.length);
  const total = userScore + opponentScore;
  const userShare = total > 0 ? Math.round((userScore / total) * 100) : 50;

  return (
    <div className="matchup-tab">
      <section className="panel" aria-labelledby="matchup-heading">
        <h2 id="matchup-heading" className="visually-hidden">
          Matchup
        </h2>
        <div className="matchup-hero" aria-label={`${matchup.userTeam.teamName} score against ${matchup.opponentTeam.teamName}`}>
          <div className="matchup-hero-scores">
            <div className="matchup-hero-team">
              <span className="score-name">{matchup.userTeam.teamName}</span>
              <span className="matchup-hero-score">{userScore}</span>
            </div>
            <span className="versus">{isLive ? <span className="live-pill">Live</span> : matchup.periodLabel}</span>
            <div className="matchup-hero-team right">
              <span className="score-name">{matchup.opponentTeam.teamName}</span>
              <span className="matchup-hero-score">{opponentScore}</span>
            </div>
          </div>
          <div className="matchup-share" aria-hidden="true">
            <span className="matchup-share-user" style={{ width: `${userShare}%` }} />
          </div>
        </div>

        {/* Yahoo-style category totals directly under the score: this week's
            numbers hug the centered category column, and the leading side's
            value reads green. The result is spelled out for screen readers. */}
        <h3 id="category-heading">Category Breakdown</h3>
        <div className="category-table" aria-labelledby="category-heading">
          <div className="category-row category-head" aria-hidden="true">
            <span>{matchup.userTeam.teamName}</span>
            <span>Cat</span>
            <span>{matchup.opponentTeam.teamName}</span>
          </div>
          {categoryScores.map((score) => (
            <div className="category-row" key={score.category}>
              <span className={score.result === "win" ? "category-value leading" : "category-value"}>{score.userValue}</span>
              <span className="category-cat">{score.category}</span>
              <span className={score.result === "loss" ? "category-value leading" : "category-value"}>
                {score.opponentValue}
              </span>
              <span className="visually-hidden">
                {score.result === "tie" ? "tied" : score.result === "win" ? "you lead" : "opponent leads"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="compare-heading">
        <h3 id="compare-heading">Starters Head to Head</h3>
        <div className="matchup-compare" aria-label="Starters head to head">
          {Array.from({ length: rowCount }).map((_, index) => {
            const user = userStarters[index];
            const opponent = opponentStarters[index];
            const slot = user?.slot ?? opponent?.slot ?? "";
            return (
              <div className="compare-row" key={`${slot}-${index}`}>
                <CompareSide entry={user} livePoints={livePoints} align="left" />
                <span className="compare-slot">{slot}</span>
                <CompareSide entry={opponent} livePoints={livePoints} align="right" />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CompareSide({
  entry,
  livePoints,
  align,
}: {
  entry: LineupPlayer | undefined;
  livePoints: Record<string, number>;
  align: "left" | "right";
}) {
  if (!entry) {
    return <span className={`compare-side ${align} empty`}>—</span>;
  }
  const live = livePoints[entry.player.id];
  const points = live ?? rowPoints(entry.player).seasonPts;
  return (
    <span className={`compare-side ${align}`}>
      <span className="compare-info">
        <span className="player-name">{entry.player.name}</span>
        <span className="player-meta">
          {entry.player.mlbTeam} &ndash; {entry.player.positions.join(", ")}
        </span>
      </span>
      <span className={live !== undefined ? "compare-pts is-live" : "compare-pts"}>{points}</span>
    </span>
  );
}
