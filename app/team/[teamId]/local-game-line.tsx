"use client";

import { useSyncExternalStore } from "react";
import { formatGameLine } from "@/lib/fantasy/player-view";
import type { Player } from "@/lib/fantasy/types";
import { LineupStatusBadge } from "./lineup-status-badge";

const subscribe = () => () => undefined;

type LocalGameLineProps = {
  className: string;
  nextGame: Player["nextGame"];
  status: Player["status"];
  statusDetail?: string | null;
  liveText?: string | null;
  lineupStatus?: Player["todaysLineupStatus"];
  battingOrder?: number | null;
};

/**
 * Match server and hydration output in UTC, then switch to the viewer's local
 * time after hydration without forcing React to discard the server markup.
 */
export function LocalGameLine({
  className,
  nextGame,
  status,
  statusDetail,
  liveText,
  lineupStatus,
  battingOrder,
}: LocalGameLineProps) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const preferredTimeZone = hydrated ? document.documentElement.dataset.timeZone : "UTC";
  const gameLine =
    liveText ?? formatGameLine(nextGame, status, statusDetail, preferredTimeZone);

  return (
    <span className={`${className}${lineupStatus ? " has-lineup-status" : ""}`}>
      {lineupStatus ? <LineupStatusBadge status={lineupStatus} battingOrder={battingOrder ?? null} /> : null}
      <span className="player-game-text">{gameLine}</span>
    </span>
  );
}
