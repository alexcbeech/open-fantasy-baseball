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
 * A compact live stat line, e.g. "1-3, 1 R, 1 HR, 2 RBI" for hitters or
 * "5.0 IP, 6 K, 1 ER" for pitchers, from whatever the boxscore has so far.
 * Shared by the lineup rows and the player detail sheet's live card.
 */
export function liveLineSummary(stats: Record<string, number | string>): string {
  if (stats.IP !== undefined) {
    const parts = [`${stats.IP} IP`];
    if (stats.K !== undefined) parts.push(`${stats.K} K`);
    if (stats.ER !== undefined) parts.push(`${stats.ER} ER`);
    if (Number(stats.W) > 0) parts.push("W");
    if (Number(stats.SV) > 0) parts.push("SV");
    return parts.join(", ");
  }

  const parts: string[] = [];
  if (stats.H !== undefined || stats.AB !== undefined) {
    parts.push(`${stats.H ?? 0}-${stats.AB ?? 0}`);
  }
  if (Number(stats.R) > 0) parts.push(`${stats.R} R`);
  if (Number(stats.HR) > 0) parts.push(`${stats.HR} HR`);
  if (Number(stats.RBI) > 0) parts.push(`${stats.RBI} RBI`);
  if (Number(stats.SB) > 0) parts.push(`${stats.SB} SB`);
  return parts.length ? parts.join(", ") : "Not in yet";
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
