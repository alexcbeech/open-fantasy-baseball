import { describe, expect, it } from "vitest";
import { getDefaultScheduleWindow } from "./mlb-sync";

describe("MLB sync", () => {
  it("uses a schedule window from yesterday through the next week", () => {
    expect(getDefaultScheduleWindow(new Date("2026-07-02T12:00:00.000Z"))).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-09",
    });
  });
});
