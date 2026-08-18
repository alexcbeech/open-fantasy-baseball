"use client";

import { useSyncExternalStore } from "react";
import { formatGameLine } from "@/lib/fantasy/player-view";
import type { Player } from "@/lib/fantasy/types";

const subscribe = () => () => undefined;

type LocalGameLineProps = {
  className: string;
  nextGame: Player["nextGame"];
  status: Player["status"];
  statusDetail?: string | null;
  liveText?: string | null;
};

/**
 * Match server and hydration output in UTC, then switch to the viewer's local
 * time after hydration without forcing React to discard the server markup.
 */
export function LocalGameLine({ className, nextGame, status, statusDetail, liveText }: LocalGameLineProps) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const preferredTimeZone = hydrated ? document.documentElement.dataset.timeZone : "UTC";
  const gameLine =
    liveText ?? formatGameLine(nextGame, status, statusDetail, preferredTimeZone);

  return <span className={className}>{gameLine}</span>;
}
