import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, getLineupForTeam } = vi.hoisted(() => ({ query: vi.fn(), getLineupForTeam: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  query,
  withDemoFallback: async (operation: () => unknown) => operation(),
}));

vi.mock("./teams", () => ({ getLineupForTeam }));

import { getMatchupDetailsForTeam } from "./matchups";

beforeEach(() => {
  query.mockReset();
  getLineupForTeam.mockReset();
  getLineupForTeam.mockResolvedValue([]);
});

describe("getMatchupDetailsForTeam", () => {
  it("loads a specified historical matchup with away-team scores and category results", async () => {
    query.mockResolvedValueOnce({ rows: [{
      matchup_id: "past-matchup", period_label: "Week 1", scoring_type: "h2h-categories",
      home_team_id: "home", away_team_id: "away", home_team_name: "Home", away_team_name: "Away",
      home_score: 7, away_score: 3,
    }] }).mockResolvedValueOnce({ rows: [
      { category: "R", home_value: 20, away_value: 10, home_result: "win" },
    ] }).mockResolvedValueOnce({ rows: [] });
    const matchup = await getMatchupDetailsForTeam("away", "past-matchup");
    expect(query.mock.calls[0][1]).toEqual(["away", "past-matchup"]);
    expect(query.mock.calls[0][0]).toContain("m.id = $2");
    expect(query.mock.calls[0][0]).not.toContain("m.status = 'active'");
    expect(matchup).toMatchObject({ userScore: 3, opponentScore: 7,
      categoryScores: [{ category: "R", userValue: 10, opponentValue: 20, result: "loss" }] });
  });

  it("groups category scores by hitting and pitching configuration order", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            matchup_id: "matchup-1",
            period_label: "Week 22",
            starts_at: "2026-08-24T00:00:00.000Z",
            ends_at: "2026-08-31T00:00:00.000Z",
            scoring_type: "h2h-categories",
            home_team_id: "team-1",
            away_team_id: "team-2",
            home_team_name: "Moon Shots",
            away_team_name: "Fastballs",
            home_score: 2,
            away_score: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { category: "R", home_value: 25, away_value: 23, home_result: "win" },
          { category: "AVG", home_value: 0.27, away_value: 0.256, home_result: "win" },
          { category: "W", home_value: 4, away_value: 1, home_result: "win" },
          { category: "ERA", home_value: 4.05, away_value: 1.69, home_result: "loss" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const matchup = await getMatchupDetailsForTeam("team-1");

    expect(matchup?.categoryScores.map((score) => score.category)).toEqual(["R", "AVG", "W", "ERA"]);
    const categorySql = String(query.mock.calls[1][0]);
    expect(categorySql).toContain("join league_stat_category category");
    expect(categorySql).toContain("order by category.side, category.sort_order");
  });
});
