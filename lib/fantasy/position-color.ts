import type { RosterSlot } from "./types";

/** Coarse position families used to color the draft board and its legend. */
export type PositionGroup = "catcher" | "corner-infield" | "middle-infield" | "outfield" | "pitcher" | "utility";

const groupBySlot: Partial<Record<RosterSlot, PositionGroup>> = {
  C: "catcher",
  "1B": "corner-infield",
  "3B": "corner-infield",
  "2B": "middle-infield",
  SS: "middle-infield",
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
  { group: "corner-infield", label: "1B/3B" },
  { group: "middle-infield", label: "2B/SS" },
  { group: "outfield", label: "OF" },
  { group: "pitcher", label: "P" },
  { group: "utility", label: "UTIL" },
];
