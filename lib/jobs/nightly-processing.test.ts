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

  it("awards a single claim outright", () => {
    const decisions = decideWaiverClaimsForPlayer([{ ...baseClaim, id: "only", bidAmount: 4, priorityAtClaim: 6 }]);
    expect(decisions).toEqual([{ claimId: "only", status: "won", reason: "best_claim" }]);
  });
});

function winnerOf(candidates: WaiverClaimCandidate[]) {
  return decideWaiverClaimsForPlayer(candidates).find((decision) => decision.status === "won")?.claimId;
}

describe("waiver FAAB bidding", () => {
  it("awards the highest bid even when that team has worse waiver priority", () => {
    expect(
      winnerOf([
        { ...baseClaim, id: "low-bid-best-priority", bidAmount: 5, priorityAtClaim: 1 },
        { ...baseClaim, id: "high-bid-worst-priority", bidAmount: 9, priorityAtClaim: 99 },
      ]),
    ).toBe("high-bid-worst-priority");
  });

  it("treats a missing bid as $0 so any positive bid outranks it", () => {
    expect(
      winnerOf([
        { ...baseClaim, id: "no-bid", bidAmount: null, priorityAtClaim: 1 },
        { ...baseClaim, id: "one-dollar-bid", bidAmount: 1, priorityAtClaim: 50 },
      ]),
    ).toBe("one-dollar-bid");
  });
});

describe("waiver priority tie-breaks", () => {
  it("falls back to the lower priority number when bids are equal", () => {
    expect(
      winnerOf([
        { ...baseClaim, id: "priority-3", bidAmount: 4, priorityAtClaim: 3 },
        { ...baseClaim, id: "priority-1", bidAmount: 4, priorityAtClaim: 1 },
      ]),
    ).toBe("priority-1");
  });

  it("uses pure rolling priority when no team bids FAAB", () => {
    expect(
      winnerOf([
        { ...baseClaim, id: "priority-2", bidAmount: null, priorityAtClaim: 2 },
        { ...baseClaim, id: "priority-1", bidAmount: null, priorityAtClaim: 1 },
      ]),
    ).toBe("priority-1");
  });

  it("ranks a set priority ahead of a missing priority at equal bid", () => {
    expect(
      winnerOf([
        { ...baseClaim, id: "no-priority", bidAmount: 2, priorityAtClaim: null },
        { ...baseClaim, id: "priority-5", bidAmount: 2, priorityAtClaim: 5 },
      ]),
    ).toBe("priority-5");
  });

  it("breaks a full tie by earliest claim submission", () => {
    expect(
      winnerOf([
        { ...baseClaim, id: "later", bidAmount: 4, priorityAtClaim: 2, createdAt: "2026-07-01T12:00:00.000Z" },
        { ...baseClaim, id: "earlier", bidAmount: 4, priorityAtClaim: 2, createdAt: "2026-07-01T09:00:00.000Z" },
      ]),
    ).toBe("earlier");
  });
});
