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
