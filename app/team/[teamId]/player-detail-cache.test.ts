import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerDetail } from "@/lib/fantasy/types";
import { cachePlayerDetail, getCachedPlayerDetail, loadPlayerDetail } from "./player-detail-cache";

const player = { id: "player-1", name: "Test Player" } as PlayerDetail;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("player detail cache", () => {
  it("shares an in-flight detail request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ player }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      loadPlayerDetail("player-1", "team-share"),
      loadPlayerDetail("player-1", "team-share"),
    ]);

    expect(first).toBe(player);
    expect(second).toBe(player);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getCachedPlayerDetail("player-1", "team-share")).toBe(player);
  });

  it("replaces cached detail after a management action", async () => {
    const updated = { ...player, name: "Updated Player" } as PlayerDetail;
    cachePlayerDetail(updated, "team-update");

    await expect(loadPlayerDetail("player-1", "team-update")).resolves.toBe(updated);
  });
});
