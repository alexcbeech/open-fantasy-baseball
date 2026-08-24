import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateFantasyPoints } from "@/lib/fantasy/scoring";
import { __clearLiveCache, extractLine, getGameLinesForPlayersOnDate } from "./mlb-live";

beforeEach(() => {
  __clearLiveCache();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A trimmed boxscore shaped like the MLB Stats API /game/{pk}/boxscore payload.
const boxscore = {
  teams: {
    home: {
      players: {
        ID100: {
          person: { id: 100 },
          stats: {
            batting: { runs: 1, homeRuns: 1, rbi: 2, stolenBases: 0, hits: 2, atBats: 4, avg: ".500" },
            pitching: {},
          },
        },
      },
    },
    away: {
      players: {
        ID200: {
          person: { id: 200 },
          stats: {
            batting: {},
            pitching: { inningsPitched: "5.0", strikeOuts: 7, earnedRuns: 1, wins: 1, hits: 3, baseOnBalls: 1, era: "1.80" },
          },
        },
      },
    },
  },
};

describe("extractLine", () => {
  it("maps a home hitter line and drops the partial-game AVG", () => {
    const line = extractLine(boxscore, 100);
    expect(line).toEqual({ R: 1, HR: 1, RBI: 2, SB: 0, H: 2, AB: 4, "1B": 1 });
    expect(line.AVG).toBeUndefined();
    expect(calculateFantasyPoints(line)).toBeCloseTo(18.7, 5);
  });

  it("finds a player on the away team and drops the partial-game ERA", () => {
    const line = extractLine(boxscore, 200);
    expect(line).toMatchObject({ IP: 5, O: 15, K: 7, ER: 1, W: 1, P_BB: 1, P_H: 3 });
    expect(line.ERA).toBeUndefined();
    expect(calculateFantasyPoints(line)).toBeCloseTo(35.8, 5);
  });

  it("returns an empty line for a player not in the boxscore or a null payload", () => {
    expect(extractLine(boxscore, 999)).toEqual({});
    expect(extractLine(null, 100)).toEqual({});
  });
});

describe("getGameLinesForPlayersOnDate", () => {
  it("fetches a completed game's boxscore from the requested official date", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/schedule?")) {
          return new Response(
            JSON.stringify({
              dates: [
                {
                  games: [
                    {
                      gamePk: 123,
                      status: { abstractGameState: "Final" },
                      teams: { home: { team: { id: 10 } }, away: { team: { id: 20 } } },
                    },
                  ],
                },
              ],
            }),
          );
        }
        if (url.endsWith("/game/123/boxscore")) {
          return new Response(JSON.stringify(boxscore));
        }
        return new Response("Not found", { status: 404 });
      }),
    );

    const result = await getGameLinesForPlayersOnDate(
      [{ id: "player-100", mlb_player_id: 100, current_mlb_team_id: 10 }],
      "2026-08-13",
      "https://stats.test/api/v1",
    );

    expect(requestedUrls[0]).toContain("date=2026-08-13");
    expect(result.liveGameInProgress).toBe(false);
    expect(result.lines["player-100"]).toMatchObject({ state: "Final", points: 18.7 });
  });

  it("combines both games of a doubleheader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/schedule?")) {
          return new Response(
            JSON.stringify({
              dates: [
                {
                  games: [
                    {
                      gamePk: 123,
                      status: { abstractGameState: "Final" },
                      teams: { home: { team: { id: 10 } }, away: { team: { id: 20 } } },
                    },
                    {
                      gamePk: 124,
                      status: { abstractGameState: "Final" },
                      teams: { home: { team: { id: 10 } }, away: { team: { id: 20 } } },
                    },
                  ],
                },
              ],
            }),
          );
        }
        if (url.endsWith("/game/123/boxscore") || url.endsWith("/game/124/boxscore")) {
          return new Response(JSON.stringify(boxscore));
        }
        return new Response("Not found", { status: 404 });
      }),
    );

    const result = await getGameLinesForPlayersOnDate(
      [{ id: "player-100", mlb_player_id: 100, current_mlb_team_id: 10 }],
      "2026-08-13",
      "https://stats.test/api/v1",
    );

    expect(result.lines["player-100"].stats).toMatchObject({ R: 2, HR: 2, RBI: 4, H: 4, AB: 8, "1B": 2 });
    expect(result.lines["player-100"].points).toBe(37.4);
  });
});
