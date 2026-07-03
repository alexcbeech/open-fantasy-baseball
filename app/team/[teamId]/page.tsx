import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { LineupEditor } from "./lineup-editor";
import { PlayersBrowser } from "./players-browser";
import { PlayerWatchButton } from "./player-watch-button";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { getLeagueOverview } from "@/lib/data/leagues";
import { getMatchupDetailsForTeam } from "@/lib/data/matchups";
import { listPlayers } from "@/lib/data/players";
import { getLineupForTeam, getTeamSummary } from "@/lib/data/teams";
import { players as mockPlayers } from "@/lib/fantasy/mock-data";
import { formatScoringType } from "@/lib/fantasy/scoring";
import type { LeagueOverview, LineupPlayer, MatchupDetails, Player } from "@/lib/fantasy/types";

type TeamPageProps = {
  params: Promise<{
    teamId: string;
  }>;
  searchParams: Promise<{
    tab?: string;
  }>;
};

const tabs = ["Team", "Matchup", "Players", "League"] as const;

export default async function TeamPage({ params, searchParams }: TeamPageProps) {
  const { teamId } = await params;
  const { tab } = await searchParams;
  const authEnabled = isNeonAuthConfigured();
  const currentUser = await getCurrentOfbUser();

  if (!currentUser && authEnabled) {
    redirect("/auth/sign-in");
  }

  const team = await getTeamSummary(teamId);
  const selectedTab = tabs.find((candidate) => candidate.toLowerCase() === tab?.toLowerCase()) ?? "Team";
  const teamLineup = await getLineupForTeam(teamId);
  const playerPool = selectedTab === "Players" ? await listPlayers() : mockPlayers;
  const matchupDetails = selectedTab === "Matchup" ? await getMatchupDetailsForTeam(teamId) : null;
  const leagueOverview = selectedTab === "League" && team ? await getLeagueOverview(team.leagueId) : null;

  if (!team) {
    notFound();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <div className="brand-lockup">
          <span className="brand-kicker">{team.leagueName}</span>
          <span className="brand-title">{team.teamName}</span>
        </div>
        <div className="topbar-actions">
          <AuthControl enabled={authEnabled} />
          <Link className="icon-button" href={`/team/${team.id}?tab=league`} aria-label="Open league and commissioner tools">
            &#8943;
          </Link>
        </div>
      </header>

      <section className="page">
        <div className="team-hero">
          <div>
            <h1>{team.teamName}</h1>
            <div className="subtle">
              {formatScoringType(team.scoringType)} - {team.record} - Rank #{team.rank}
            </div>
          </div>
          <div className="score-row">
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
        </div>

        <nav className="tabbar" aria-label="Team sections">
          {tabs.map((candidate) => {
            const href = candidate === "Team" ? `/team/${team.id}` : `/team/${team.id}?tab=${candidate.toLowerCase()}`;
            return (
              <Link className={candidate === selectedTab ? "tab active" : "tab"} href={href} key={candidate}>
                {candidate}
              </Link>
            );
          })}
        </nav>

        {selectedTab === "Team" ? <TeamTab teamId={team.id} lineup={teamLineup} watchPlayers={playerPool} /> : null}
        {selectedTab === "Matchup" ? (
          matchupDetails ? <MatchupTab matchup={matchupDetails} /> : <MatchupEmptyState teamName={team.teamName} />
        ) : null}
        {selectedTab === "Players" ? <PlayersTab teamId={team.id} players={playerPool} /> : null}
        {selectedTab === "League" && leagueOverview ? <LeagueTab overview={leagueOverview} /> : null}
      </section>
    </main>
  );
}

function TeamTab({ teamId, lineup, watchPlayers }: { teamId: string; lineup: LineupPlayer[]; watchPlayers: Player[] }) {
  return (
    <div className="team-tab">
      <div className="team-toolbar">
        <PlayerWatchButton players={watchPlayers} />
      </div>
      <LineupEditor teamId={teamId} initialLineup={lineup} />
    </div>
  );
}

function MatchupTab({ matchup }: { matchup: MatchupDetails }) {
  return (
    <div className="content-grid">
      <section className="panel" aria-labelledby="matchup-heading">
        <h2 id="matchup-heading">Category Score</h2>
        <div className="matchup-summary" aria-label={`${matchup.userTeam.teamName} score against ${matchup.opponentTeam.teamName}`}>
          <div>
            <span className="score-name">{matchup.userTeam.teamName}</span>
            <span className="score-value">{matchup.userScore}</span>
          </div>
          <span className="versus">{matchup.periodLabel}</span>
          <div>
            <span className="score-name">{matchup.opponentTeam.teamName}</span>
            <span className="score-value">{matchup.opponentScore}</span>
          </div>
        </div>
        <div className="category-table">
          <div className="category-row category-head">
            <span>{matchup.userTeam.teamName}</span>
            <span>Cat</span>
            <span>{matchup.opponentTeam.teamName}</span>
            <span>Result</span>
          </div>
          {matchup.categoryScores.map((score) => (
            <div className="category-row" key={score.category}>
              <strong>{score.userValue}</strong>
              <span className="slot">{score.category}</span>
              <strong>{score.opponentValue}</strong>
              <span className={`pill result-${score.result}`}>{score.result.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </section>

      <aside className="panel" aria-labelledby="totals-heading">
        <h3 id="totals-heading">Active Totals</h3>
        <div className="lineup-list">
          {matchup.userLineup.slice(0, 6).map((entry) => (
            <div className="row" key={entry.player.id}>
              <span className="slot">{entry.slot}</span>
              <span className="player-main">
                <span className="player-name">{entry.player.name}</span>
                <span className="player-meta">{entry.player.mlbTeam}</span>
              </span>
              <span className="player-total">{entry.matchupTotal}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function MatchupEmptyState({ teamName }: { teamName: string }) {
  return (
    <section className="panel" aria-labelledby="matchup-empty-heading">
      <h2 id="matchup-empty-heading">No Active Matchup</h2>
      <div className="empty-state">
        {teamName} isn&apos;t scheduled in a head-to-head matchup this scoring period. Check back when the next period opens,
        or open the League tab for current standings.
      </div>
    </section>
  );
}

function PlayersTab({ teamId, players }: { teamId: string; players: Player[] }) {
  return <PlayersBrowser teamId={teamId} players={players} />;
}

function LeagueTab({ overview }: { overview: LeagueOverview }) {
  return (
    <div className="content-grid">
      <section className="panel" aria-labelledby="standings-heading">
        <h2 id="standings-heading">Standings</h2>
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
            {overview.standings.map((row) => (
              <tr key={row.teamId}>
                <td>{row.rank}</td>
                <td>
                  <span className="player-name">{row.teamName}</span>
                  <span className="player-meta">{row.managerName}</span>
                </td>
                <td>{row.record}</td>
                <td>{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="panel" aria-labelledby="settings-heading">
        <h3 id="settings-heading">Commissioner</h3>
        <div className="setting-list">
          <div className="setting-row">
            <span>Teams</span>
            <strong>{overview.settings.teamCount}</strong>
          </div>
          <div className="setting-row">
            <span>IL Slots</span>
            <strong>{overview.settings.rosterSlots.IL}</strong>
          </div>
          <div className="setting-row">
            <span>Waivers</span>
            <strong>{overview.settings.waiverMode}</strong>
          </div>
          <div className="setting-row">
            <span>FAAB</span>
            <strong>${overview.settings.faabBudget}</strong>
          </div>
        </div>
        <h3>Team Stats</h3>
        <div className="setting-list">
          {overview.teamStats.slice(0, 5).map((row) => (
            <div className="setting-row" key={row.teamId}>
              <div>
                <span className="player-name">{row.teamName}</span>
                <span className="player-meta">{row.rosteredPlayers} rostered</span>
              </div>
              <strong>${row.faabRemaining}</strong>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
