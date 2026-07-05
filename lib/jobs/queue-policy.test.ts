import { describe, expect, it } from "vitest";
import { backoffSeconds, dedupKeyForDaily, nextAttemptState } from "./queue-policy";

describe("backoffSeconds", () => {
  it("grows exponentially from the base", () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);
    expect(backoffSeconds(3)).toBe(120);
    expect(backoffSeconds(4)).toBe(240);
  });

  it("caps at one hour", () => {
    expect(backoffSeconds(20)).toBe(3600);
  });

  it("treats a first attempt (or zero) as the base delay", () => {
    expect(backoffSeconds(0)).toBe(30);
  });
});

describe("nextAttemptState", () => {
  const now = new Date("2026-07-05T10:00:00Z");

  it("requeues with backoff while attempts remain", () => {
    const state = nextAttemptState(1, 3, now);
    expect(state.status).toBe("queued");
    // 30s backoff after the first failed attempt.
    expect(state.runAt).toEqual(new Date("2026-07-05T10:00:30Z"));
  });

  it("uses a longer backoff on a later attempt", () => {
    const state = nextAttemptState(2, 3, now);
    expect(state.status).toBe("queued");
    expect(state.runAt).toEqual(new Date("2026-07-05T10:01:00Z"));
  });

  it("marks the job dead once attempts reach the max", () => {
    const state = nextAttemptState(3, 3, now);
    expect(state).toEqual({ status: "dead", runAt: null });
  });

  it("marks dead if attempts somehow exceed the max", () => {
    expect(nextAttemptState(5, 3, now).status).toBe("dead");
  });
});

describe("dedupKeyForDaily", () => {
  it("keys by job type and calendar date (UTC)", () => {
    expect(dedupKeyForDaily("nightly_processing", new Date("2026-07-05T23:30:00Z"))).toBe("nightly_processing:2026-07-05");
  });

  it("gives the same key across times on the same day", () => {
    const a = dedupKeyForDaily("nightly_processing", new Date("2026-07-05T00:01:00Z"));
    const b = dedupKeyForDaily("nightly_processing", new Date("2026-07-05T18:45:00Z"));
    expect(a).toBe(b);
  });
});
