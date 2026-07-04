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
  // Lead with a live head-to-head if there is one, else the top-ranked team.
  const featured =
    teams.find((team) => team.scoringType !== "roto" && team.matchup.opponentName !== "Season Standings") ??
    teams.toSorted((left, right) => left.rank - right.rank)[0];
  const otherTeams = teams.filter((team) => team.id !== featured?.id);
  const shareFor = (team: (typeof teams)[number]) => {
    const total = team.matchup.userScore + team.matchup.opponentScore;
    return total > 0 ? Math.round((team.matchup.userScore / total) * 100) : 50;
  };

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
        {featured ? (
          <>
            <div className="section-title">
              <h2 id="featured-heading">Featured Matchup</h2>
              <span className="subtle">{featured.matchup.periodLabel}</span>
            </div>
            <Link
              className="featured-card"
              href={`/team/${featured.id}`}
              aria-label={`${featured.teamName} vs ${featured.matchup.opponentName}`}
            >
              <div className="featured-league">
                {featured.leagueName} · {formatScoringType(featured.scoringType)}
              </div>
              <div className="matchup-hero-scores">
                <div className="matchup-hero-team">
                  <span className="score-name">{featured.teamName}</span>
                  <span className="matchup-hero-score">{featured.matchup.userScore}</span>
                </div>
                <span className="versus">vs</span>
                <div className="matchup-hero-team right">
                  <span className="score-name">{featured.matchup.opponentName}</span>
                  <span className="matchup-hero-score">{featured.matchup.opponentScore}</span>
                </div>
              </div>
              <div className="matchup-share" aria-hidden="true">
                <span className="matchup-share-user" style={{ width: `${shareFor(featured)}%` }} />
              </div>
            </Link>
          </>
        ) : null}

        <div className="section-title">
          <h2 id="teams-heading">My Teams</h2>
          <span className="subtle">{teams.length} total</span>
        </div>

        <div className="team-list">
          {otherTeams.map((team) => {
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

                <div className="progress" aria-label={`${shareFor(team)}% score share`}>
                  <span style={{ width: `${shareFor(team)}%` }} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
