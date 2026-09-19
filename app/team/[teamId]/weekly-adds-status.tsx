export function WeeklyAddsStatus({ usage, timeZone }: {
  usage: { used: number; limit: number; resetsAt: string | null } | null;
  timeZone: string;
}) {
  if (!usage) return null;
  const remaining = Math.max(0, usage.limit - usage.used);
  return (
    <section className="panel weekly-adds-status" aria-label="Weekly player adds">
      <strong>Adds this week: {usage.used}/{usage.limit}</strong>
      <p>{remaining === 0
        ? "Weekly add limit reached. You cannot add free agents or submit new waiver claims until the next matchup."
        : `${remaining} player ${remaining === 1 ? "add" : "adds"} remaining. Successful waiver claims count toward this limit.`}</p>
      {usage.resetsAt ? <p className="player-meta">Resets {new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
      }).format(new Date(usage.resetsAt))} at matchup rollover.</p> : null}
    </section>
  );
}
