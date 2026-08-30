import { inningsFromIpNotation } from "./scoring";
import type { Player, StatCategory } from "./types";

export type LineupStatSide = "hitting" | "pitching";

export function playerStatSide(player: Pick<Player, "positions">): LineupStatSide {
  return player.positions.some((position) => ["SP", "RP", "P"].includes(position)) ? "pitching" : "hitting";
}

export function lineupCategoryColumns(side: LineupStatSide, categories: StatCategory[]): string[] {
  const contextColumn = side === "hitting" ? "H/AB" : "IP";
  return [contextColumn, ...categories];
}

function numberStat(stats: Record<string, number | string>, key: string): number {
  const parsed = Number(stats[key]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAverage(stats: Record<string, number | string>) {
  const atBats = numberStat(stats, "AB");
  return atBats ? (numberStat(stats, "H") / atBats).toFixed(3).replace(/^0/, "") : "-";
}

function formatEra(stats: Record<string, number | string>) {
  const innings = inningsFromIpNotation(stats.IP);
  return innings ? ((numberStat(stats, "ER") * 9) / innings).toFixed(2) : "-";
}

function formatWhip(stats: Record<string, number | string>) {
  const innings = inningsFromIpNotation(stats.IP);
  const walks = numberStat(stats, stats.P_BB !== undefined ? "P_BB" : "BB");
  const hits = numberStat(stats, stats.P_H !== undefined ? "P_H" : "HA");
  return innings ? ((walks + hits) / innings).toFixed(2) : "-";
}

function formatInnings(stats: Record<string, number | string>) {
  if (stats.O !== undefined) {
    const outs = numberStat(stats, "O");
    return `${Math.floor(outs / 3)}.${outs % 3}`;
  }
  if (stats.IP === undefined) {
    return "-";
  }
  const value = String(stats.IP);
  return value.includes(".") ? value : `${value}.0`;
}

/** Yahoo-style single-day roster value for one configured category column. */
export function formatLineupCategoryValue({
  category,
  hasTodayLine,
  side,
  stats,
}: {
  category: string;
  hasTodayLine: boolean;
  side: LineupStatSide;
  stats: Record<string, number | string>;
}) {
  if (category === "H/AB") {
    if (!hasTodayLine) return "0/0";
    if (stats.H === undefined && stats.AB === undefined) return "-/-";
    return `${stats.H ?? 0}/${stats.AB ?? 0}`;
  }

  if (side === "pitching" && !Object.keys(stats).length) {
    return "-";
  }

  if (category === "AVG") return formatAverage(stats);
  if (category === "ERA") return formatEra(stats);
  if (category === "WHIP") return formatWhip(stats);
  if (category === "IP") return formatInnings(stats);

  if (stats[category] !== undefined) {
    return String(stats[category]);
  }
  return side === "hitting" && !hasTodayLine ? "0" : "-";
}
