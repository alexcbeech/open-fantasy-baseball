"use client";

import { useEffect, useState } from "react";
import type { LiveMatchupUpdate } from "@/lib/fantasy/types";

/**
 * Poll a team's live matchup recalculation while the component is mounted.
 * Returns null until the first response (or when the team has no active
 * matchup); when `hasTodayStats` is false the caller should keep showing its
 * stored values. Shared by the Matchup tab and every live score row.
 */
export function useLiveMatchup(teamId: string): LiveMatchupUpdate | null {
  const [update, setUpdate] = useState<LiveMatchupUpdate | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/teams/${teamId}/matchup/live`);
        if (!response.ok) {
          return;
        }
        const result = (await response.json()) as { update?: LiveMatchupUpdate | null };
        if (active) {
          setUpdate(result.update ?? null);
        }
      } catch {
        // Keep the last known values on a transient failure.
      }
    };

    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [teamId]);

  return update;
}
