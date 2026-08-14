import type { PlayerDetail } from "@/lib/fantasy/types";

const detailTtlMs = 60_000;

type CacheEntry = {
  expiresAt: number;
  promise: Promise<PlayerDetail>;
  value?: PlayerDetail;
};

const browserGlobal = globalThis as typeof globalThis & {
  __ofbPlayerDetailCache?: Map<string, CacheEntry>;
};
const detailCache = (browserGlobal.__ofbPlayerDetailCache ??= new Map<string, CacheEntry>());

function cacheKey(playerId: string, teamId: string) {
  return `${teamId}:${playerId}`;
}

export function loadPlayerDetail(playerId: string, teamId: string): Promise<PlayerDetail> {
  const key = cacheKey(playerId, teamId);
  const cached = detailCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = fetch(`/api/v1/players/${playerId}?teamId=${encodeURIComponent(teamId)}`)
    .then(async (response) => {
      const result = (await response.json()) as { player?: PlayerDetail; error?: string };

      if (!response.ok || !result.player) {
        throw new Error(result.error ?? "Player detail could not be loaded.");
      }

      return result.player;
    })
    .catch((error) => {
      detailCache.delete(key);
      throw error;
    });

  detailCache.set(key, { expiresAt: Date.now() + detailTtlMs, promise });
  void promise
    .then((value) => {
      const current = detailCache.get(key);
      if (current?.promise === promise) {
        current.value = value;
      }
    })
    .catch(() => undefined);
  return promise;
}

export function getCachedPlayerDetail(playerId: string, teamId: string) {
  const cached = detailCache.get(cacheKey(playerId, teamId));
  return cached && cached.expiresAt > Date.now() ? cached.value ?? null : null;
}

export function prefetchPlayerDetail(playerId: string, teamId: string) {
  void loadPlayerDetail(playerId, teamId).catch(() => undefined);
}

export function cachePlayerDetail(player: PlayerDetail, teamId: string) {
  detailCache.set(cacheKey(player.id, teamId), {
    expiresAt: Date.now() + detailTtlMs,
    promise: Promise.resolve(player),
    value: player,
  });
}
