import { describe, expect, it } from "vitest";
import { commissionerSettingsMatrix, getSettingsForScoringType } from "./settings-matrix";

describe("commissioner settings matrix", () => {
  it("contains settings for every supported scoring format", () => {
    expect(getSettingsForScoringType("h2h-categories").length).toBeGreaterThan(10);
    expect(getSettingsForScoringType("h2h-points").some((setting) => setting.key === "pointsWeights")).toBe(true);
    expect(getSettingsForScoringType("roto").some((setting) => setting.key === "playoffTeamCount")).toBe(false);
  });

  it("marks draft-sensitive settings as locked after draft", () => {
    const lockedKeys = commissionerSettingsMatrix.filter((setting) => setting.locksAfterDraft).map((setting) => setting.key);

    expect(lockedKeys).toContain("scoringType");
    expect(lockedKeys).toContain("teamCount");
    expect(lockedKeys).toContain("rosterSlots");
  });
});
