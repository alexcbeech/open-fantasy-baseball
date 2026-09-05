import { describe, expect, it } from "vitest";
import { isLineupDate, lineupToday, shiftLineupDate } from "./lineup-date";

describe("lineup dates", () => {
  it("uses the ET baseball day across midnight UTC", () => {
    expect(lineupToday(new Date("2026-09-06T02:00:00Z"))).toBe("2026-09-05");
  });
  it("accepts only real ISO dates", () => {
    expect(isLineupDate("2028-02-29")).toBe(true);
    for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "09/05/2026", null, ["2026-09-05"]]) expect(isLineupDate(date)).toBe(false);
  });
  it("navigates month and year boundaries", () => {
    expect(shiftLineupDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftLineupDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});
