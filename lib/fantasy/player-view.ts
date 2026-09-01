import { calculateFantasyPoints } from "./scoring";
import type { Player, PlayerDetail, PlayerNextGame } from "./types";

export const statusLabels: Record<Player["status"], string> = {
  active: "Active",
  "day-to-day": "Day-to-Day",
  injured: "Injured",
  minors: "Minors",
};

/** Prefer MLB's specific designation while retaining the coarse app status. */
export function playerStatusLabel(player: Pick<Player, "status" | "statusDetail">): string {
  return player.statusDetail || statusLabels[player.status];
}

/**
 * The two numbers shown on the right of a Yahoo-style player row: bold season
 * fantasy points to date, and the muted rest-of-season projection. The stored
 * season total is preferred (so it matches the detail sheet) and falls back to
 * computing from the season stat line in demo/mock mode.
 */
export function rowPoints(player: Player) {
  const seasonPts = player.seasonPoints ?? Math.round(calculateFantasyPoints(player.seasonStats) * 10) / 10;
  const projPts = Math.round(calculateFantasyPoints(player.projectedStats) * 10) / 10;
  return { seasonPts, projPts };
}

const hitterStatOrder = ["AVG", "HR", "R", "RBI", "SB", "H", "AB"];
const pitcherStatOrder = ["ERA", "WHIP", "W", "SV", "K", "IP"];
const hitterPositions = new Set(["C", "1B", "2B", "3B", "SS", "OF", "UTIL"]);
const pitcherPositions = new Set(["SP", "RP", "P"]);

function hasStat(stats: Record<string, number | string>, key: string) {
  const value = stats[key];
  return value !== undefined && value !== null && value !== "";
}

function isPitcher(player: Pick<Player, "positions" | "seasonStats">): boolean {
  const hasHitterPosition = player.positions.some((position) => hitterPositions.has(position));
  const hasPitcherPosition = player.positions.some((position) => pitcherPositions.has(position));

  // Eligibility is more reliable than the shape of the combined MLB stat
  // payload. A position player may have a tiny mop-up pitching line, while a
  // two-way player should still receive the more useful hitter overview.
  if (hasHitterPosition) return false;
  if (hasPitcherPosition) return true;

  // Defensive fallback for incomplete eligibility data.
  return ["IP", "GS", "ERA", "WHIP"].some((key) => hasStat(player.seasonStats, key));
}

function playerSurname(name: string): string {
  const parts = name.trim().split(/\s+/);
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const last = parts.at(-1)?.replace(/[.,]/g, "").toLowerCase();
  if (parts.length > 1 && last && suffixes.has(last)) {
    return parts.at(-2)?.replace(/,$/, "") ?? name;
  }
  return parts.at(-1) ?? name;
}

function countWord(value: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return Number.isInteger(value) && value >= 0 && value < words.length ? words[value] : String(value);
}

function naturalList(parts: string[]): string {
  if (parts.length < 2) return parts[0] ?? "";
  if (parts.length === 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function hitterCountingLine(stats: Record<string, number | string>): string[] {
  const definitions = [
    { key: "HR", singular: "home run", plural: "home runs" },
    { key: "RBI", singular: "RBI", plural: "RBI" },
    { key: "R", singular: "run", plural: "runs" },
    { key: "SB", singular: "stolen base", plural: "stolen bases" },
  ];

  return definitions.flatMap(({ key, singular, plural }) => {
    if (!hasStat(stats, key) || Number(stats[key]) <= 0) return [];
    const value = Number(stats[key]);
    return [`${countWord(value)} ${value === 1 ? singular : plural}`];
  });
}

function hitterRateLine(stats: Record<string, number | string>): string | null {
  if (!hasStat(stats, "AVG")) return null;
  if (hasStat(stats, "OBP") && hasStat(stats, "SLG")) {
    return `${stats.AVG}/${stats.OBP}/${stats.SLG}`;
  }
  return String(stats.AVG);
}

function hitterSummary(name: string, stats: Record<string, number | string>, period: string): string | null {
  const rate = hitterRateLine(stats);
  const counting = hitterCountingLine(stats);
  if (!rate && !counting.length) return null;

  const subject = playerSurname(name);
  const production = counting.length ? ` with ${naturalList(counting)}` : "";
  return `${subject} ${rate ? `is hitting ${rate}` : "has produced"}${production} ${period}.`;
}

/**
 * A plain-language player overview modeled after Yahoo's recent-performance
 * blurb. Position eligibility determines hitter vs. pitcher so a position
 * player's incidental pitching stats never displace their batting summary.
 */
export function playerOverviewSummary(
  player: Pick<PlayerDetail, "name" | "positions" | "seasonStats" | "statWindows">,
): string | null {
  const stats = player.seasonStats ?? {};

  if (!isPitcher(player)) {
    const recent = player.statWindows.find((window) => window.split === "last_7")?.stats;
    return (recent && hitterSummary(player.name, recent, "over the last seven days"))
      || hitterSummary(player.name, stats, "this season");
  }

  const rates: string[] = [];
  if (hasStat(stats, "ERA")) rates.push(`a ${stats.ERA} ERA`);
  if (hasStat(stats, "WHIP")) rates.push(`a ${stats.WHIP} WHIP`);

  const counting: string[] = [];
  if (hasStat(stats, "W")) counting.push(`${stats.W} ${Number(stats.W) === 1 ? "win" : "wins"}`);
  if (hasStat(stats, "SV")) counting.push(`${stats.SV} ${Number(stats.SV) === 1 ? "save" : "saves"}`);
  if (hasStat(stats, "K")) counting.push(`${stats.K} strikeouts`);

  if (!rates.length && !counting.length) return null;
  const lead = rates.length ? `has ${rates.join(" and ")}` : "has";
  return `${player.name} ${lead}${counting.length ? ` with ${counting.join(", ")}` : ""} this season.`;
}

/** A deterministic compact season line for player lists and draft details. */
export function seasonStatLine(player: Player, limit = 5): string | null {
  const stats = player.seasonStats ?? {};
  const preferred = isPitcher(player) ? pitcherStatOrder : hitterStatOrder;
  const orderedKeys = [
    ...preferred.filter((key) => stats[key] !== undefined),
    ...Object.keys(stats).filter((key) => !preferred.includes(key)),
  ].slice(0, limit);

  if (!orderedKeys.length) {
    return null;
  }

  return orderedKeys.map((key) => `${stats[key]} ${key}`).join(" · ");
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
export function formatGameLine(
  nextGame: PlayerNextGame | null | undefined,
  status: Player["status"],
  statusDetail?: string | null,
  timeZone?: string,
) {
  if (status !== "active") {
    return statusDetail || statusLabels[status];
  }
  if (nextGame) {
    const when = new Date(nextGame.date).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
    const versus = nextGame.homeAway === "home" ? "vs" : "@";
    return `${when} ${versus} ${nextGame.opponent ?? "TBD"}`;
  }
  return "No game";
}
