import type { RosterSlot } from "@/lib/fantasy/types";

const reserveSlots: RosterSlot[] = ["BN", "IL", "NA"];

type PositionBadgeProps = {
  slot: RosterSlot;
  swap?: boolean;
};

/**
 * The colored circular slot badge used across the lineup, move/fill sheets, and
 * player lists. Active starting slots are brand-filled; reserve slots (bench,
 * IL, minors) are muted. Presentational only — callers wrap it in a button when
 * it should be interactive.
 */
export function PositionBadge({ slot, swap = false }: PositionBadgeProps) {
  const variant = reserveSlots.includes(slot) ? "reserve" : "active";

  return (
    <span className={`pos-badge pos-badge-${variant}`} aria-hidden="true">
      <span className="pos-badge-slot">{slot}</span>
      {swap ? (
        <span className="pos-badge-swap" aria-hidden="true">
          &#8645;
        </span>
      ) : null}
    </span>
  );
}
