import type { RosterSlot } from "./types";

/** Position families used to color the draft board and its legend. */
export type PositionGroup =
  | "catcher"
  | "first-base"
  | "second-base"
  | "third-base"
  | "shortstop"
  | "outfield"
  | "pitcher"
  | "utility";

const groupBySlot: Partial<Record<RosterSlot, PositionGroup>> = {
  C: "catcher",
  "1B": "first-base",
  "2B": "second-base",
  "3B": "third-base",
  SS: "shortstop",
  OF: "outfield",
  SP: "pitcher",
  RP: "pitcher",
  P: "pitcher",
  UTIL: "utility",
};

export function positionGroup(position: string): PositionGroup {
  return groupBySlot[position as RosterSlot] ?? "utility";
}

/** CSS class carrying the group's color; paired with rules in globals.css. */
export function positionGroupClass(position: string): string {
  return `pos-group-${positionGroup(position)}`;
}

export const positionGroupLegend: { group: PositionGroup; label: string }[] = [
  { group: "catcher", label: "C" },
  { group: "first-base", label: "1B" },
  { group: "second-base", label: "2B" },
  { group: "third-base", label: "3B" },
  { group: "shortstop", label: "SS" },
  { group: "outfield", label: "OF" },
  { group: "pitcher", label: "P" },
  { group: "utility", label: "UTIL" },
];
