import { describe, expect, it } from "vitest";
import { calculateFantasyPoints } from "@/lib/fantasy/scoring";
import { extractLine } from "./mlb-live";

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
    expect(line).toEqual({ R: 1, HR: 1, RBI: 2, SB: 0, H: 2, AB: 4 });
    expect(line.AVG).toBeUndefined();
    // R + HR*4 + RBI = 1 + 4 + 2 = 7
    expect(calculateFantasyPoints(line)).toBe(7);
  });

  it("finds a player on the away team and drops the partial-game ERA", () => {
    const line = extractLine(boxscore, 200);
    expect(line).toMatchObject({ IP: 5, K: 7, ER: 1, W: 1 });
    expect(line.ERA).toBeUndefined();
    // IP*3 + K - ER + W*5 = 15 + 7 - 1 + 5 = 26
    expect(calculateFantasyPoints(line)).toBe(26);
  });

  it("returns an empty line for a player not in the boxscore or a null payload", () => {
    expect(extractLine(boxscore, 999)).toEqual({});
    expect(extractLine(null, 100)).toEqual({});
  });
});
