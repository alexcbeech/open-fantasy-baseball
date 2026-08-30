import { describe, expect, it } from "vitest";
import { hasTradeDeadlinePassed } from "./trade-deadline";

describe("hasTradeDeadlinePassed", () => {
  const deadline = "2026-08-31T19:00:00.000Z";

  it("leaves trading open when no deadline is configured", () => {
    expect(hasTradeDeadlinePassed(null, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("keeps trading open before the deadline", () => {
    expect(hasTradeDeadlinePassed(deadline, new Date("2026-08-31T18:59:59.999Z"))).toBe(false);
  });

  it("closes trading at the deadline instant", () => {
    expect(hasTradeDeadlinePassed(deadline, new Date(deadline))).toBe(true);
  });
});
