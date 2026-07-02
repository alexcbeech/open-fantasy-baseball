import { describe, expect, it } from "vitest";
import { decideWaiverClaimsForPlayer, getNightlyProcessingWindow } from "./nightly-processing";
import type { WaiverClaimCandidate } from "./nightly-processing";

const baseClaim: WaiverClaimCandidate = {
  id: "claim-1",
  leagueId: "league-1",
  teamId: "team-1",
  addPlayerId: "player-1",
  dropPlayerId: null,
  bidAmount: null,
  priorityAtClaim: null,
  createdAt: "2026-07-01T10:00:00.000Z",
};

describe("nightly processing", () => {
  it("uses the expected nightly processing window", () => {
    expect(getNightlyProcessingWindow("America/Los_Angeles")).toEqual({
      localStartTime: "03:00",
      timeZone: "America/Los_Angeles",
      expectedDurationMinutes: 30,
    });
  });

  it("awards a waiver claim by bid, then priority, then creation time", () => {
    const decisions = decideWaiverClaimsForPlayer([
      { ...baseClaim, id: "low-bid", bidAmount: 3, priorityAtClaim: 1 },
      { ...baseClaim, id: "high-bid", bidAmount: 8, priorityAtClaim: 8 },
      { ...baseClaim, id: "same-high-later", bidAmount: 8, priorityAtClaim: 9, createdAt: "2026-07-01T11:00:00.000Z" },
    ]);

    expect(decisions).toEqual([
      { claimId: "high-bid", status: "won", reason: "best_claim" },
      { claimId: "same-high-later", status: "lost", reason: "lower_priority" },
      { claimId: "low-bid", status: "lost", reason: "lower_priority" },
    ]);
  });

  it("marks every claim lost when the player is unavailable", () => {
    const decisions = decideWaiverClaimsForPlayer(
      [
        { ...baseClaim, id: "claim-1" },
        { ...baseClaim, id: "claim-2" },
      ],
      false,
    );

    expect(decisions).toEqual([
      { claimId: "claim-1", status: "lost", reason: "player_unavailable" },
      { claimId: "claim-2", status: "lost", reason: "player_unavailable" },
    ]);
  });
});
