import type { PostedLineupStatus } from "@/lib/fantasy/types";

/** Yahoo-style batting-order number, or a red X when the batter is confirmed out. */
export function LineupStatusBadge({ status, battingOrder }: PostedLineupStatus) {
  const starting = status === "starting";
  const label = starting ? `Batting ${battingOrder} in today's posted lineup` : "Not in today's posted lineup";

  return (
    <span
      className={starting ? "lineup-status-badge is-starting" : "lineup-status-badge is-out"}
      title={label}
      aria-label={label}
      role="img"
    >
      {starting ? battingOrder : <span aria-hidden="true">&times;</span>}
    </span>
  );
}
