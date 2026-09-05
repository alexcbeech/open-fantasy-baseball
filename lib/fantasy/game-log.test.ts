import { describe, expect, it } from "vitest";
import { mergePlayerGameLog } from "./game-log";
import type { PlayerGameLog } from "./types";

const game = (id: string, gamePk: number | null, date = "2026-09-05T00:00:00Z"): PlayerGameLog => ({ id, gamePk, date, stats: { H: 2, AB: 4 } });

describe("mergePlayerGameLog", () => {
  it("shows today's games before older imported rows and keeps doubleheaders separate", () => {
    expect(mergePlayerGameLog([game("old", 1, "2026-09-04T00:00:00Z")], [game("first", 2), game("second", 3)]).map((row) => row.id))
      .toEqual(["first", "second", "old"]);
  });
  it("replaces imported duplicates with fresh boxscores without summing their stats", () => {
    const result = mergePlayerGameLog([game("stored", 2), game("legacy", null)], [game("fresh", 2)]);
    expect(result).toEqual([game("fresh", 2)]);
  });
  it("keeps imported history if boxscores are unavailable", () => {
    expect(mergePlayerGameLog([game("stored", 2)], [])).toEqual([game("stored", 2)]);
  });
});
