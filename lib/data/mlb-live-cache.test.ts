import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearLiveCache, cachedFetchJson } from "./mlb-live";

const base = "https://example.test/api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("cachedFetchJson", () => {
  beforeEach(() => {
    __clearLiveCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    __clearLiveCache();
  });

  it("serves a repeated URL from cache within the TTL (one upstream fetch)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await cachedFetchJson<{ n: number }>("/schedule", base, 60_000);
    const second = await cachedFetchJson<{ n: number }>("/schedule", base, 60_000);

    expect(first).toEqual({ n: 1 });
    expect(second).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent calls for the same URL into a single fetch (single-flight)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ n: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b, c] = await Promise.all([
      cachedFetchJson("/game/1/boxscore", base, 15_000),
      cachedFetchJson("/game/1/boxscore", base, 15_000),
      cachedFetchJson("/game/1/boxscore", base, 15_000),
    ]);

    expect([a, b, c]).toEqual([{ n: 2 }, { n: 2 }, { n: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ n: 3 }));
    vi.stubGlobal("fetch", fetchMock);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);

    await cachedFetchJson("/game/2/linescore", base, 15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still within the 15s window: cached.
    nowSpy.mockReturnValue(10_000);
    await cachedFetchJson("/game/2/linescore", base, 15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the window: refetch.
    nowSpy.mockReturnValue(20_000);
    await cachedFetchJson("/game/2/linescore", base, 15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed request, so the next call retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ n: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await cachedFetchJson("/schedule", base, 60_000)).toBeNull();
    expect(await cachedFetchJson("/schedule", base, 60_000)).toEqual({ n: 4 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
