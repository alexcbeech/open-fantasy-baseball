import { calculateFantasyPoints } from "./scoring";
import type { Player, PlayerNextGame } from "./types";

export const statusLabels: Record<Player["status"], string> = {
  active: "Active",
  "day-to-day": "Day-to-Day",
  injured: "Injured",
  minors: "Minors",
};

/**
 * The two numbers shown on the right of a Yahoo-style player row: bold season
 * fantasy points to date, and the muted rest-of-season projection. The stored
 * season total is preferred (so it matches the detail sheet) and falls back to
 * computing from the season stat line in demo/mock mode.
 */
export function rowPoints(player: Player) {
  const seasonPts = player.seasonPoints ?? Math.round(calculateFantasyPoints(player.seasonStats));
  const projPts = Math.round(calculateFantasyPoints(player.projectedStats));
  return { seasonPts, projPts };
}

/**
 * The row's game-context line: the player's next game ("Fri 1:05 PM @ CHC"),
 * or a status note when they're not active or have no upcoming game.
 */
export function formatGameLine(nextGame: PlayerNextGame | null | undefined, status: Player["status"]) {
  if (nextGame) {
    const when = new Date(nextGame.date).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    const versus = nextGame.homeAway === "home" ? "vs" : "@";
    return `${when} ${versus} ${nextGame.opponent ?? "TBD"}`;
  }
  if (status !== "active") {
    return statusLabels[status];
  }
  return "No game";
}
