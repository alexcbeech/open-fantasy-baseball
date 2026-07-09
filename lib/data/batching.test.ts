import { describe, expect, it } from "vitest";
import { chunk, mapWithConcurrency } from "./batching";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [30, 0, 10];
    const results = await mapWithConcurrency(delays, 2, async (delay, index) => {
      await sleep(delay);
      return index * 2;
    });
    expect(results).toEqual([0, 2, 4]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(5);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    // Sanity check that work actually overlapped.
    expect(peak).toBeGreaterThan(1);
  });

  it("rejects with the first error and stops starting new items", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (item) => {
        started.push(item);
        if (item === 2) {
          throw new Error("boom");
        }
        await sleep(5);
      }),
    ).rejects.toThrow("boom");
    // The other worker may finish its in-flight item, but the queue drains no further.
    expect(started.length).toBeLessThan(8);
  });

  it("handles empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits items into fixed-size chunks with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns no chunks for empty input", () => {
    expect(chunk([], 2)).toEqual([]);
  });
});
