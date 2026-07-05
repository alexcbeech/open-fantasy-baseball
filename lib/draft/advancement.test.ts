import { describe, expect, it } from "vitest";
import { computeExpiredTurns, deadlineForTurn, type DraftClockState } from "./advancement";

const base = new Date("2026-07-04T18:00:00Z");

function seconds(n: number): Date {
  return new Date(base.getTime() + n * 1000);
}

function clockState(overrides: Partial<DraftClockState> = {}): DraftClockState {
  return {
    status: "in_progress",
    currentOverallPick: 1,
    currentPickDeadline: seconds(60),
    pickSeconds: 60,
    botPickSeconds: 5,
    teamCount: 4,
    rounds: 3,
    onClockIsBot: () => false,
    ...overrides,
  };
}

describe("deadlineForTurn", () => {
  it("uses the human clock for humans and the short clock for bots", () => {
    expect(deadlineForTurn(base, false, 60, 5)).toEqual(seconds(60));
    expect(deadlineForTurn(base, true, 60, 5)).toEqual(seconds(5));
  });
});

describe("computeExpiredTurns", () => {
  it("returns nothing while the current deadline is in the future", () => {
    const result = computeExpiredTurns(clockState(), seconds(30));
    expect(result.expiredPicks).toEqual([]);
    expect(result.nextDeadline).toEqual(seconds(60));
    expect(result.complete).toBe(false);
  });

  it("expires a single missed human turn and sets the next deadline", () => {
    const result = computeExpiredTurns(clockState(), seconds(61));
    expect(result.expiredPicks).toEqual([1]);
    // Next turn started at the moment pick 1 expired (t=60), 60s human clock.
    expect(result.nextDeadline).toEqual(seconds(120));
    expect(result.complete).toBe(false);
  });

  it("resolves a cascade of consecutive bot turns in one call", () => {
    // Picks 1-5 are bots on a 5s clock; poller arrives 30s in.
    const result = computeExpiredTurns(
      clockState({ currentPickDeadline: seconds(5), onClockIsBot: (pick) => pick <= 5 }),
      seconds(30),
    );
    expect(result.expiredPicks).toEqual([1, 2, 3, 4, 5]);
    // Pick 6 (human) started at t=25, so its deadline is t=85.
    expect(result.nextDeadline).toEqual(seconds(85));
  });

  it("is idempotent: identical inputs give identical outputs", () => {
    const state = clockState({ onClockIsBot: (pick) => pick % 2 === 0 });
    const first = computeExpiredTurns(state, seconds(300));
    const second = computeExpiredTurns(state, seconds(300));
    expect(second).toEqual(first);
  });

  it("caps the batch and lets the next call continue", () => {
    // Everything is a 5s bot; a poll after a long gap catches up 20 at a time.
    const state = clockState({
      rounds: 10,
      currentPickDeadline: seconds(5),
      onClockIsBot: () => true,
    });
    const result = computeExpiredTurns(state, seconds(100000), 20);
    expect(result.expiredPicks).toHaveLength(20);
    expect(result.complete).toBe(false);
  });

  it("completes the draft when the final pick expires", () => {
    // 4 teams x 3 rounds = 12 picks; on the clock at pick 12, expired.
    const result = computeExpiredTurns(
      clockState({ currentOverallPick: 12, currentPickDeadline: seconds(60) }),
      seconds(61),
    );
    expect(result.expiredPicks).toEqual([12]);
    expect(result.nextDeadline).toBeNull();
    expect(result.complete).toBe(true);
  });

  it("no-ops when paused or complete", () => {
    for (const status of ["paused", "complete", "setup"] as const) {
      const result = computeExpiredTurns(clockState({ status }), seconds(10000));
      expect(result.expiredPicks).toEqual([]);
    }
  });
});
