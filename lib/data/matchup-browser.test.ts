import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, details } = vi.hoisted(() => ({ query: vi.fn(), details: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ query, withDemoFallback: (operation: () => unknown) => operation() }));
vi.mock("./matchups", () => ({ getMatchupDetailsForTeam: details }));
import { getMatchupBrowser, selectPeriod, type MatchupPeriod } from "./matchup-browser";

const periods: MatchupPeriod[] = ["final", "active", "scheduled"].map((status, index) => ({
  id: `period-${index}`, label: `Week ${index + 1}`, starts_at: "2026-06-01", ends_at: "2026-06-08",
  status: status as MatchupPeriod["status"],
}));
const matchups = [
  { id: "other", home_team_id: "other-home", away_team_id: "other-away", status: "active" },
  { id: "mine", home_team_id: "opponent", away_team_id: "viewer-team", status: "active" },
];

beforeEach(() => {
  query.mockReset(); details.mockReset(); details.mockResolvedValue(null);
});

describe("league matchup browser", () => {
  it("selects requested past and future periods, otherwise defaults to current, upcoming, or latest final", () => {
    expect(selectPeriod(periods)?.id).toBe("period-1");
    expect(selectPeriod(periods, "period-0")?.status).toBe("final");
    expect(selectPeriod(periods, "period-2")?.status).toBe("scheduled");
    expect(selectPeriod(periods, "unknown")?.id).toBe("period-1");
    expect(selectPeriod([periods[0], periods[2]])?.id).toBe("period-2");
    expect(selectPeriod([periods[0]])?.id).toBe("period-0");
    expect(selectPeriod([])).toBeUndefined();
  });

  it("defaults to the viewer's matchup and retains the away-team perspective", async () => {
    query.mockResolvedValueOnce({ rows: periods }).mockResolvedValueOnce({ rows: matchups });
    const result = await getMatchupBrowser("league", "viewer-team");
    expect(result.selected?.id).toBe("mine");
    expect(details).toHaveBeenCalledWith("viewer-team", "mine");
  });

  it("allows another league matchup while scoping period and matchup reads to the authorized league", async () => {
    query.mockResolvedValueOnce({ rows: periods }).mockResolvedValueOnce({ rows: matchups });
    await getMatchupBrowser("league", "viewer-team", "period-0", "other");
    expect(query.mock.calls[0][1]).toEqual(["league"]);
    expect(query.mock.calls[1][0]).toContain("m.league_id = $1 and m.scoring_period_id = $2");
    expect(query.mock.calls[1][1]).toEqual(["league", "period-0"]);
    expect(details).toHaveBeenCalledWith("other-home", "other");
  });

  it("never loads an unrecognized or cross-league matchup ID", async () => {
    query.mockResolvedValueOnce({ rows: periods }).mockResolvedValueOnce({ rows: matchups });
    await getMatchupBrowser("league", "viewer-team", "foreign-period", "foreign-matchup");
    expect(details).toHaveBeenCalledWith("viewer-team", "mine");
  });

  it("supports empty periods and no schedule without loading matchup details", async () => {
    query.mockResolvedValueOnce({ rows: periods }).mockResolvedValueOnce({ rows: [] });
    expect((await getMatchupBrowser("league", "viewer-team")).selected).toBeUndefined();
    query.mockResolvedValueOnce({ rows: [] });
    expect((await getMatchupBrowser("league", "viewer-team")).period).toBeUndefined();
    expect(details).not.toHaveBeenCalled();
  });
});
