import { players as mockPlayers } from "@/lib/fantasy/mock-data";
import type { DraftPlayer, DraftState } from "./types";

export const mockDraftLeagueId = "league-1";

const teamNames = [
  ["Warning Track Power", "Sam", false],
  ["Bullpen Cartel", "Riley", false],
  ["Bot: Bleacher Creatures", "OFB Bot", true],
  ["Bot: Rally Caps", "OFB Bot", true],
  ["Golden Sombreros", "Alex", false],
  ["Bot: Dinger City", "OFB Bot", true],
  ["Bot: The Shift", "OFB Bot", true],
  ["Moonshot Society", "Casey", false],
  ["Pine Tar Pirates", "Drew", false],
  ["Cycle Chasers", "Morgan", false],
  ["Box Score Poets", "Jordan", false],
  ["Windmill Whiffs", "Quinn", false],
] as const;

// The mock player pool has only 8 players, so the frozen draft makes 4 picks
// (leaving 4 available for the board) and parks the viewer's team on the
// clock at 1.05.
const MOCK_PICK_COUNT = 4;

/**
 * A frozen early-round-1 snake draft used when no database is configured, so
 * the draft room renders (read-only) in demo mode and Playwright smoke can
 * exercise it. Mutating draft routes return 503 in mock mode.
 */
export function mockDraftState(now = new Date()): DraftState {
  const teams = teamNames.map(([name, managerName, isBot], index) => ({
    teamId: `team-mock-${index + 1}`,
    name,
    managerName,
    isBot,
    position: index + 1,
  }));

  const picks = mockPlayers.slice(0, MOCK_PICK_COUNT).map((player, index) => {
    const team = teams[index];

    return {
      overallPick: index + 1,
      round: 1,
      pickInRound: index + 1,
      teamId: team.teamId,
      playerId: player.id,
      playerName: player.name,
      positions: player.positions,
      madeBy: (team.isBot ? "bot" : "human") as "bot" | "human",
    };
  });

  return {
    draftId: "draft-mock-1",
    leagueId: mockDraftLeagueId,
    leagueName: "Sunday Night Rotisserie",
    status: "in_progress",
    pickSeconds: 60,
    rounds: 23,
    teamCount: 12,
    teams,
    picks,
    // Position 5 (the viewer's team) is on the clock at 1.05.
    onClock: { teamId: teams[MOCK_PICK_COUNT].teamId, overallPick: MOCK_PICK_COUNT + 1, round: 1, pickInRound: MOCK_PICK_COUNT + 1 },
    deadline: new Date(now.getTime() + 45_000).toISOString(),
    serverNow: now.toISOString(),
    myTeamId: teams[MOCK_PICK_COUNT].teamId,
    viewerIsCommissioner: true,
    myQueue: [],
    myAutoPick: false,
    autoPickTeamIds: teams.filter((team) => team.isBot).map((team) => team.teamId),
    scheduledStartAt: null,
  };
}

/** Undrafted mock players ranked by a fake ADP for the demo draft board. */
export function mockDraftPlayers(): DraftPlayer[] {
  const draftedIds = new Set(mockDraftState().picks.map((pick) => pick.playerId));

  return mockPlayers
    .filter((player) => !draftedIds.has(player.id))
    .map((player, index) => ({
      ...player,
      availability: "free-agent" as const,
      adpRank: MOCK_PICK_COUNT + index + 1,
      adp: MOCK_PICK_COUNT + index + 1.4,
    }));
}
