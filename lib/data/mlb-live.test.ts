import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateFantasyPoints } from "@/lib/fantasy/scoring";
import {
  __clearLiveCache,
  extractLine,
  getGameLinesForPlayersOnDate,
  getPlayerTodayGames,
  getPostedLineupStatusesForPlayers,
} from "./mlb-live";

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

describe("getPlayerTodayGames", () => {
  it("includes final and live games separately using the ET official date", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(String(input));
      return new Response(JSON.stringify(String(input).includes("/schedule?")
        ? { dates: [{ games: [
          { gamePk: 1, status: { abstractGameState: "Final" } },
          { gamePk: 2, status: { abstractGameState: "Live" } },
          { gamePk: 3, status: { abstractGameState: "Preview" } },
        ] }] } : boxscore));
    }));
    const rows = await getPlayerTodayGames(100, 10, "https://stats.test/api/v1", new Date("2026-09-06T02:00:00Z"));
    expect(rows.map((row) => row.gamePk)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ date: "2026-09-05T00:00:00.000Z", stats: { H: 2, AB: 4, HR: 1 } });
    expect(urls[0]).toContain("date=2026-09-05");
    expect(urls.some((url) => url.includes("/game/3/"))).toBe(false);
  });
  it("does not fabricate zero-stat games for missing players or failed boxscores", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(String(input).includes("/schedule?")
      ? { dates: [{ games: [{ gamePk: 1, status: { abstractGameState: "Final" } }] }] } : boxscore))));
    expect(await getPlayerTodayGames(999, 10, "https://stats.test/api/v1")).toEqual([]);
    __clearLiveCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unavailable", { status: 503 })));
    expect(await getPlayerTodayGames(100, 10, "https://stats.test/api/v1")).toEqual([]);
  });
});

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

describe("getPostedLineupStatusesForPlayers", () => {
  it("maps batting-order spots and marks omitted players after the lineup is posted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            dates: [
              {
                games: [
                  {
                    gamePk: 123,
                    teams: { home: { team: { id: 10 } }, away: { team: { id: 20 } } },
                    lineups: {
                      homePlayers: [{ id: 101 }, { id: 100 }],
                      awayPlayers: [{ id: 200 }],
                    },
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );

    const result = await getPostedLineupStatusesForPlayers(
      [
        { id: "batting-second", mlb_player_id: 100, current_mlb_team_id: 10 },
        { id: "on-bench", mlb_player_id: 999, current_mlb_team_id: 10 },
      ],
      "https://stats.test/api/v1",
      new Date("2026-08-30T18:00:00.000Z"),
    );

    expect(result["batting-second"]).toEqual({ status: "starting", battingOrder: 2 });
    expect(result["on-bench"]).toEqual({ status: "not-starting", battingOrder: null });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("hydrate=lineups");
  });

  it("keeps an omitted doubleheader player unknown until every lineup is posted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            dates: [
              {
                games: [
                  {
                    gamePk: 123,
                    teams: { home: { team: { id: 10 } }, away: { team: { id: 20 } } },
                    lineups: { homePlayers: [{ id: 101 }], awayPlayers: [{ id: 200 }] },
                  },
                  {
                    gamePk: 124,
                    teams: { home: { team: { id: 10 } }, away: { team: { id: 20 } } },
                  },
                ],
              },
            ],
          }),
        ),
      ),
    );

    const result = await getPostedLineupStatusesForPlayers(
      [{ id: "doubleheader-bat", mlb_player_id: 999, current_mlb_team_id: 10 }],
      "https://stats.test/api/v1",
      new Date("2026-08-30T18:00:00.000Z"),
    );

    expect(result["doubleheader-bat"]).toBeUndefined();
  });
});
