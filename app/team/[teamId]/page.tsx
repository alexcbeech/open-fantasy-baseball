import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { BrandLockup } from "@/app/brand-lockup";
import { DraftCountdown } from "@/app/draft-countdown";
import { LiveScoreRow } from "@/app/live-score-row";
import { LineupEditor } from "./lineup-editor";
import { PlayersBrowser } from "./players-browser";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { getTeamAccess, isLeagueCommissioner, isLeagueCreator } from "@/lib/auth/team-access";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";
import { LeagueInviteButton } from "./league-invite-button";
import { LeagueSettingsEditor } from "./league-settings-editor";
import { LeagueStandings } from "./league-standings";
import { TradesPanel } from "./trades-panel";
import { DeleteLeagueButton } from "./delete-league-button";
import { getLeagueDraftStatus } from "@/lib/data/draft";
import { getLeagueOverview, getLeagueSettings } from "@/lib/data/leagues";
import { getMatchupDetailsForTeam } from "@/lib/data/matchups";
import { getPlayerWatchForTeam, listPlayers } from "@/lib/data/players";
import { LiveMatchup } from "./live-matchup";
import { getLineupForTeam, getTeamSummary } from "@/lib/data/teams";
import { formatDraftTime } from "@/lib/draft/schedule";
import { formatScoringType } from "@/lib/fantasy/scoring";
import { measureServerOperation } from "@/lib/observability/server-performance";
import type { LeagueOverview, LineupLockMode, LineupPlayer, MatchupDetails, Player, PlayerWatchItem } from "@/lib/fantasy/types";

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
  const selectedTab = tabs.find((candidate) => candidate.toLowerCase() === tab?.toLowerCase()) ?? "Team";
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

  const team = await measureServerOperation("team.summary", () => getTeamSummary(teamId));

  if (!team) {
    notFound();
  }

  // Once the team establishes league context, the remaining reads are
  // independent. Run only the selected tab's work and do it concurrently with
  // the shared settings reads so client navigation is not a serial DB waterfall.
  const [
    leagueSettings,
    leagueDraftStatus,
    teamLineup,
    playerPool,
    watchItems,
    matchupDetails,
    leagueOverview,
    viewerIsCommissioner,
    viewerIsCreator,
  ] = await Promise.all([
    measureServerOperation("team.league-settings", () => getLeagueSettings(team.leagueId)),
    measureServerOperation("team.draft-status", () => getLeagueDraftStatus(team.leagueId)),
    selectedTab === "Team"
      ? measureServerOperation("team.lineup", () => getLineupForTeam(teamId))
      : Promise.resolve([]),
    selectedTab === "Players"
      ? measureServerOperation("team.player-pool", () => listPlayers({ leagueId: team.leagueId }))
      : Promise.resolve([]),
    selectedTab === "Team"
      ? measureServerOperation("team.player-watch", () => getPlayerWatchForTeam(teamId))
      : Promise.resolve([]),
    selectedTab === "Matchup"
      ? measureServerOperation("team.matchup", () => getMatchupDetailsForTeam(teamId))
      : Promise.resolve(null),
    selectedTab === "League"
      ? measureServerOperation("team.league-overview", () => getLeagueOverview(team.leagueId))
      : Promise.resolve(null),
    selectedTab === "League" && currentUser ? isLeagueCommissioner(team.leagueId, currentUser) : Promise.resolve(false),
    selectedTab === "League" && currentUser ? isLeagueCreator(team.leagueId, currentUser) : Promise.resolve(false),
  ]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <BrandLockup clip kicker={team.leagueName} title={team.teamName} />
        <div className="topbar-actions">
          <AuthControl enabled={authEnabled} />
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
          {leagueDraftStatus && ["pre_draft", "drafting"].includes(leagueDraftStatus.leagueStatus) ? (
            <div className="pre-draft-summary" role="status">
              <span className="pill pre-draft-pill">
                {leagueDraftStatus.leagueStatus === "drafting" ? "Drafting" : "Pre-draft"}
              </span>
              <div className="pre-draft-summary-copy">
                <strong>
                  {leagueDraftStatus.leagueStatus === "drafting"
                    ? "Draft in progress"
                    : leagueDraftStatus.scheduledStartAt
                    ? `Draft: ${formatDraftTime(new Date(leagueDraftStatus.scheduledStartAt))}`
                    : "Draft date and time not scheduled"}
                </strong>
                <span>
                  {leagueDraftStatus.leagueStatus === "drafting"
                    ? "Join the draft room to make your picks."
                    : "Free-agent adds and waiver claims are disabled until the draft is complete."}
                </span>
                {leagueDraftStatus.leagueStatus === "pre_draft" && leagueDraftStatus.scheduledStartAt ? (
                  <DraftCountdown scheduledStartAt={leagueDraftStatus.scheduledStartAt} />
                ) : null}
              </div>
              <Link className="secondary-button" href={`/draft/${team.leagueId}`}>
                Open draft
              </Link>
            </div>
          ) : (
            <LiveScoreRow
              teamId={team.id}
              teamName={team.teamName}
              opponentName={team.matchup.opponentName}
              periodLabel={team.matchup.periodLabel}
              initialUserScore={team.matchup.userScore}
              initialOpponentScore={team.matchup.opponentScore}
            />
          )}
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

        {selectedTab === "Team" ? (
          <TeamTab teamId={team.id} lineup={teamLineup} watchItems={watchItems} lockMode={leagueSettings.lineupLockMode} />
        ) : null}
        {selectedTab === "Matchup" ? (
          matchupDetails ? <MatchupTab matchup={matchupDetails} teamId={team.id} /> : <MatchupEmptyState teamName={team.teamName} />
        ) : null}
        {selectedTab === "Players" ? <PlayersTab teamId={team.id} players={playerPool} /> : null}
        {selectedTab === "League" && leagueOverview ? (
          <LeagueTab
            overview={leagueOverview}
            canManage={viewerIsCommissioner}
            canDelete={viewerIsCreator}
            viewerTeamId={team.id}
            canTrade={viewerManagesTeam}
          />
        ) : null}
      </section>
    </main>
  );
}

function TeamTab({
  teamId,
  lineup,
  watchItems,
  lockMode,
}: {
  teamId: string;
  lineup: LineupPlayer[];
  watchItems: PlayerWatchItem[];
  lockMode: LineupLockMode;
}) {
  // Recent news renders as a small icon on each affected player's row (the
  // detail sheet carries the full story), replacing the old Player Watch button.
  const newsByPlayerId = Object.fromEntries(watchItems.map((item) => [item.id, item.headline]));

  return (
    <div className="team-tab">
      <LineupEditor teamId={teamId} initialLineup={lineup} lockMode={lockMode} newsByPlayerId={newsByPlayerId} />
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
  canManage,
  canDelete,
  viewerTeamId,
  canTrade,
}: {
  overview: LeagueOverview;
  canManage: boolean;
  canDelete: boolean;
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
        {canManage ? (
          <div className="commissioner-actions">
            <LeagueInviteButton leagueId={overview.leagueId} />
            <LeagueSettingsEditor leagueId={overview.leagueId} settings={overview.settings} />
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
        {canDelete ? (
          <div className="league-danger-zone">
            <h3>Danger Zone</h3>
            <DeleteLeagueButton leagueId={overview.leagueId} leagueName={overview.name} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
