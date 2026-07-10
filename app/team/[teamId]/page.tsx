import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { LineupEditor } from "./lineup-editor";
import { PlayersBrowser } from "./players-browser";
import { PlayerWatchButton } from "./player-watch-button";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { getTeamAccess, isLeagueCommissioner } from "@/lib/auth/team-access";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";
import { LeagueInviteButton } from "./league-invite-button";
import { LeagueStandings } from "./league-standings";
import { TradesPanel } from "./trades-panel";
import { getLeagueOverview } from "@/lib/data/leagues";
import { getMatchupDetailsForTeam } from "@/lib/data/matchups";
import { getPlayerWatchForTeam, listPlayers } from "@/lib/data/players";
import { LiveMatchup } from "./live-matchup";
import { getLineupForTeam, getTeamSummary } from "@/lib/data/teams";
import { formatScoringType } from "@/lib/fantasy/scoring";
import type { LeagueOverview, LineupPlayer, MatchupDetails, Player, PlayerWatchItem } from "@/lib/fantasy/types";

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

  // With a real database, a non-UUID id (e.g. the demo "team-1") can't match a
  // row, so the data layer would silently fall back to mock data. 404 instead
  // so real-DB mode never masquerades as populated. Demo mode (no DATABASE_URL)
  // still serves the mock team ids.
  if (isDatabaseConfigured() && !isUuid(teamId)) {
    notFound();
  }

  // Team pages are league-private: only members of the team's league (or its
  // commissioner) may view them. The API routes enforce the same rule.
  let viewerManagesTeam = !isDatabaseConfigured();

  if (isDatabaseConfigured() && currentUser) {
    const access = await getTeamAccess(teamId, currentUser);

    if (access === "not-found" || access === "none") {
      notFound();
    }

    viewerManagesTeam = access === "manager";
  }

  const team = await getTeamSummary(teamId);
  const selectedTab = tabs.find((candidate) => candidate.toLowerCase() === tab?.toLowerCase()) ?? "Team";
  const teamLineup = await getLineupForTeam(teamId);
  const playerPool = selectedTab === "Players" && team ? await listPlayers({ leagueId: team.leagueId }) : [];
  const watchItems = selectedTab === "Team" ? await getPlayerWatchForTeam(teamId) : [];
  const matchupDetails = selectedTab === "Matchup" ? await getMatchupDetailsForTeam(teamId) : null;
  const leagueOverview = selectedTab === "League" && team ? await getLeagueOverview(team.leagueId) : null;
  const viewerIsCommissioner =
    selectedTab === "League" && team && currentUser ? await isLeagueCommissioner(team.leagueId, currentUser) : false;

  if (!team) {
    notFound();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <div className="brand-lockup brand-lockup--clip">
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

        {selectedTab === "Team" ? <TeamTab teamId={team.id} lineup={teamLineup} watchItems={watchItems} /> : null}
        {selectedTab === "Matchup" ? (
          matchupDetails ? <MatchupTab matchup={matchupDetails} teamId={team.id} /> : <MatchupEmptyState teamName={team.teamName} />
        ) : null}
        {selectedTab === "Players" ? <PlayersTab teamId={team.id} players={playerPool} /> : null}
        {selectedTab === "League" && leagueOverview ? (
          <LeagueTab overview={leagueOverview} canInvite={viewerIsCommissioner} viewerTeamId={team.id} canTrade={viewerManagesTeam} />
        ) : null}
      </section>
    </main>
  );
}

function TeamTab({ teamId, lineup, watchItems }: { teamId: string; lineup: LineupPlayer[]; watchItems: PlayerWatchItem[] }) {
  return (
    <div className="team-tab">
      <div className="team-toolbar">
        <PlayerWatchButton items={watchItems} />
      </div>
      <LineupEditor teamId={teamId} initialLineup={lineup} />
    </div>
  );
}

function MatchupTab({ matchup, teamId }: { matchup: MatchupDetails; teamId: string }) {
  return <LiveMatchup matchup={matchup} teamId={teamId} />;
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

function LeagueTab({
  overview,
  canInvite,
  viewerTeamId,
  canTrade,
}: {
  overview: LeagueOverview;
  canInvite: boolean;
  viewerTeamId: string;
  canTrade: boolean;
}) {
  return (
    <div className="content-grid">
      <section className="panel" aria-labelledby="standings-heading">
        <h2 id="standings-heading">Standings</h2>
        <LeagueStandings
          standings={overview.standings}
          leagueId={overview.leagueId}
          viewerTeamId={viewerTeamId}
          canTrade={canTrade}
        />
      </section>

      <TradesPanel leagueId={overview.leagueId} viewerTeamId={viewerTeamId} />

      <aside className="panel" aria-labelledby="settings-heading">
        <h3 id="settings-heading">Commissioner</h3>
        {canInvite ? (
          <div className="commissioner-actions">
            <LeagueInviteButton leagueId={overview.leagueId} />
          </div>
        ) : null}
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
