import { describe, expect, it, vi } from "vitest";
import { ensureTodayLineupSnapshot } from "./lineup-snapshots";

describe("ensureTodayLineupSnapshot", () => {
  it("copies the latest effective lineup into an immutable ET-dated snapshot", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ lineup_date: "2026-08-23", scoring_period_id: "period-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const snapshot = await ensureTodayLineupSnapshot({ query } as never, "team-1", "league-1");

    expect(snapshot).toEqual({ lineupDate: "2026-08-23", scoringPeriodId: "period-1" });
    expect(query.mock.calls[0][0]).toContain("America/New_York");
    expect(query.mock.calls[1][0]).toContain("lineup_date <= $3::date");
    expect(query.mock.calls[1][0]).toContain("on conflict (team_id, player_id, lineup_date) do nothing");
    expect(query.mock.calls[1][1]).toEqual(["team-1", "period-1", "2026-08-23"]);
  });

  it("does not create a snapshot when the league has no active scoring period", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ lineup_date: "2026-08-23", scoring_period_id: null }] });

    await expect(ensureTodayLineupSnapshot({ query } as never, "team-1", "league-1")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
