import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "./auth-control";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listTeamsForCurrentUser } from "@/lib/data/teams";
import { formatScoringType } from "@/lib/fantasy/scoring";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authEnabled = isNeonAuthConfigured();
  const currentUser = await getCurrentOfbUser();

  if (!currentUser && authEnabled) {
    redirect("/auth/sign-in");
  }

  const teams = await listTeamsForCurrentUser();
  const bestRank = Math.min(...teams.map((team) => team.rank));
  const activeMatchups = teams.filter((team) => team.scoringType !== "roto").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-kicker">Open Fantasy</span>
          <span className="brand-title">Baseball</span>
        </div>
        <div className="topbar-actions">
          <AuthControl enabled={authEnabled} />
          {currentUser?.isAdmin ? (
            <Link className="icon-button" href="/admin" aria-label="Open admin operations">
              Ops
            </Link>
          ) : null}
          <Link className="icon-button" href="/league/new" aria-label="Create league">
            +
          </Link>
          <Link className="icon-button" href="/profile" aria-label="Open profile and preferences">
            ⚙
          </Link>
        </div>
      </header>

      <section className="page" aria-labelledby="teams-heading">
        <div className="summary-strip" aria-label="Fantasy baseball summary">
          <div className="summary-stat">
            <span className="summary-label">Teams</span>
            <span className="summary-value">{teams.length}</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Best Rank</span>
            <span className="summary-value">#{bestRank}</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Live Matchups</span>
            <span className="summary-value">{activeMatchups}</span>
          </div>
        </div>

        <div className="section-title">
          <h2 id="teams-heading">My Teams</h2>
          <span className="subtle">Today</span>
        </div>

        <div className="team-list">
          {teams.map((team) => {
            const isWinning = team.matchup.userScore >= team.matchup.opponentScore;

            return (
              <Link className="team-card" href={`/team/${team.id}`} key={team.id}>
                <div className="team-card-header">
                  <div>
                    <div className="team-name">{team.teamName}</div>
                    <div className="league-name">
                      {team.leagueName} · {formatScoringType(team.scoringType)}
                    </div>
                  </div>
                  <span className={isWinning ? "pill" : "pill loss"}>Rank #{team.rank}</span>
                </div>

                <div className="score-row" aria-label={`${team.teamName} score against ${team.matchup.opponentName}`}>
                  <div className="score-team">
                    <span className="score-name">{team.teamName}</span>
                    <span className="score-value">{team.matchup.userScore}</span>
                  </div>
                  <span className="versus">{team.matchup.periodLabel}</span>
                  <div className="score-team">
                    <span className="score-name">{team.matchup.opponentName}</span>
                    <span className="score-value">{team.matchup.opponentScore}</span>
                  </div>
                </div>

                <div className="progress" aria-label={`${team.matchup.progressPercent}% of scoring period complete`}>
                  <span style={{ width: `${team.matchup.progressPercent}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
