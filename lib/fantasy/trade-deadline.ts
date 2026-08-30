/** A null deadline leaves trading open. The deadline instant itself is closed. */
export function hasTradeDeadlinePassed(deadline: Date | string | null, now = new Date()): boolean {
  if (!deadline) {
    return false;
  }

  const deadlineMs = deadline instanceof Date ? deadline.getTime() : Date.parse(deadline);
  return Number.isFinite(deadlineMs) && now.getTime() >= deadlineMs;
}
