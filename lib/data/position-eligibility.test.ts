import { describe, expect, it, vi } from "vitest";
import { isPositionEligibilityOffseason, reconcileOffseasonPositionEligibility } from "./position-eligibility";

describe("isPositionEligibilityOffseason", () => {
  it("allows November through February only", () => {
    expect(isPositionEligibilityOffseason(new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(isPositionEligibilityOffseason(new Date("2027-02-28T00:00:00Z"))).toBe(true);
    expect(isPositionEligibilityOffseason(new Date("2027-03-01T00:00:00Z"))).toBe(false);
    expect(isPositionEligibilityOffseason(new Date("2027-10-31T00:00:00Z"))).toBe(false);
  });
});

describe("reconcileOffseasonPositionEligibility", () => {
  it("expires only stale fielding grants after a meaningful prior season", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 3 });
    const result = await reconcileOffseasonPositionEligibility(
      { query } as never,
      2027,
      new Date("2027-01-15T12:00:00Z"),
    );

    expect(result).toEqual({ upcomingSeason: 2027, expired: 3, effectiveThrough: "2027-01-14" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("qualification_method = 'fielding'"),
      ["2027-01-14", 2025, 2026, 20],
    );
    expect(query.mock.calls[0][0]).toContain("last_roster_confirmed_at");
    expect(query.mock.calls[0][0]).toContain("qualification_method = 'roster'");
  });

  it("refuses to remove eligibility during the season", async () => {
    const query = vi.fn();
    await expect(
      reconcileOffseasonPositionEligibility({ query } as never, 2027, new Date("2026-08-18T00:00:00Z")),
    ).rejects.toThrow("November through February");
    expect(query).not.toHaveBeenCalled();
  });
});
