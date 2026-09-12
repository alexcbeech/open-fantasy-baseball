import { describe, expect, it } from "vitest";
import { isLineupDate, lineupToday, shiftLineupDate } from "./lineup-date";

describe("lineup dates", () => {
  it.each([
    ["2026-09-12T04:30:00Z", "2026-09-11"],
    ["2026-09-12T06:59:59Z", "2026-09-11"],
    ["2026-09-12T07:00:00Z", "2026-09-12"],
    ["2026-01-12T07:59:59Z", "2026-01-11"],
    ["2026-01-12T08:00:00Z", "2026-01-12"],
    ["2026-03-09T06:59:59Z", "2026-03-08"],
    ["2026-11-02T07:59:59Z", "2026-11-01"],
  ])("keeps Pacific today until local midnight at %s", (instant, expected) => {
    expect(lineupToday(new Date(instant), "America/Los_Angeles")).toBe(expected);
  });
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
