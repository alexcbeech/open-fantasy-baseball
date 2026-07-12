// Pure helpers for scheduled draft starts.

/** Human-readable draft time in ET, baseball's home timezone. */
export function formatDraftTime(value: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(value);
  return `${formatted} ET`;
}

/**
 * When the pre-draft reminder should fire: an hour before the start, but never
 * in the past — a draft scheduled less than an hour out reminds immediately.
 */
export function draftReminderTime(scheduledStartAt: Date, now: Date = new Date()): Date {
  const oneHourBefore = new Date(scheduledStartAt.getTime() - 60 * 60 * 1000);
  return oneHourBefore > now ? oneHourBefore : now;
}
