import { describe, expect, it } from "vitest";
import { players } from "./mock-data";
import { validateLineup } from "./roster-validation";
import type { LineupPlayer } from "./types";

describe("lineup validation", () => {
  it("accepts a legal lineup", () => {
    const lineup: LineupPlayer[] = [
      { slot: "C", player: players[5], matchupTotal: 0 },
      { slot: "1B", player: players[6], matchupTotal: 0 },
      { slot: "OF", player: players[0], matchupTotal: 0 },
      { slot: "SP", player: players[7], matchupTotal: 0 },
      { slot: "IL", player: players[2], matchupTotal: 0 },
    ];

    expect(validateLineup(lineup).valid).toBe(true);
  });

  it("rejects duplicate players and position-ineligible slots", () => {
    const lineup: LineupPlayer[] = [
      { slot: "C", player: players[0], matchupTotal: 0 },
      { slot: "OF", player: players[0], matchupTotal: 0 },
    ];

    const validation = validateLineup(lineup);

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("duplicate-player");
    expect(validation.issues.map((issue) => issue.code)).toContain("position-ineligible");
  });
});
