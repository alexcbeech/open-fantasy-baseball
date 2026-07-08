import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "./auth-control";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listDraftableLeagues } from "@/lib/data/draft";
import { listTeamsForCurrentUser } from "@/lib/data/teams";
import { formatScoringType } from "@/lib/fantasy/scoring";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const authEnabled = isNeonAuthConfigured();
  const currentUser = await getCurrentOfbUser();

  if (!currentUser && authEnabled) {
    redirect("/auth/sign-in");
  }

  const teams = await listTeamsForCurrentUser(currentUser);
  const draftableLeagues = currentUser ? await listDraftableLeagues(currentUser.userId) : [];
  const shareFor = (team: (typeof teams)[number]) => {
    const total = team.matchup.userScore + team.matchup.opponentScore;
    return total > 0 ? Math.round((team.matchup.userScore / total) * 100) : 50;
  };

  return (
    <main className="app-shell app-shell--flush">
      <header className="topbar">
        <div className="brand-lockup brand-lockup--logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/brand/ofb-mark.svg" alt="" width={40} height={40} aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-kicker">Open Fantasy</span>
            <span className="brand-title">Baseball</span>
          </span>
        </div>
        <div className="topbar-actions">
          <AuthControl enabled={authEnabled} />
          {currentUser?.isAdmin ? (
            <Link className="icon-button" href="/admin" aria-label="Open admin operations" data-tooltip="Admin operations">
              Ops
            </Link>
          ) : null}
          <Link className="icon-button" href="/league/new" aria-label="Create league" data-tooltip="New league">
            +
          </Link>
          <Link className="icon-button" href="/profile" aria-label="Open profile and preferences" data-tooltip="Profile & preferences">
            ⚙
          </Link>
        </div>
      </header>

      <section className="page" aria-labelledby="teams-heading">
        {draftableLeagues.length ? (
          <>
            <div className="section-title">
              <h2 id="drafts-heading">Drafts</h2>
            </div>
            <div className="team-list draft-entry-list">
              {draftableLeagues.map((league) => (
                <Link className="team-card draft-entry-card" href={`/draft/${league.leagueId}`} key={league.leagueId}>
                  <div className="team-card-header">
                    <div>
                      <div className="team-name">{league.leagueName}</div>
                      <div className="league-name">
                        {league.status === "drafting" ? "Draft in progress — join the room" : "Set up your draft"}
                      </div>
                    </div>
                    <span className={league.status === "drafting" ? "pill draft-live-pill" : "pill"}>
                      {league.status === "drafting" ? "● LIVE" : "Pre-draft"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        <div className="section-title">
          <h2 id="teams-heading">My Teams</h2>
          <span className="subtle">{teams.length} total</span>
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
