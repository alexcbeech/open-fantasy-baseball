/**
 * Pure pick-clock logic. There is no background scheduler in this app, so the
 * draft clock is advanced lazily: every state read or pick attempt calls
 * computeExpiredTurns and resolves the returned picks as auto/bot picks
 * inside one transaction. Deterministic and idempotent by construction.
 */

export type DraftClockState = {
  status: "setup" | "in_progress" | "paused" | "complete";
  /** 1-based overall pick currently on the clock. */
  currentOverallPick: number;
  /** Server-authoritative deadline for the current pick; null unless in_progress. */
  currentPickDeadline: Date | null;
  pickSeconds: number;
  botPickSeconds: number;
  teamCount: number;
  rounds: number;
  onClockIsBot: (overallPick: number) => boolean;
};

export type ExpiredTurns = {
  /** Overall picks that have expired as of `now`, in order. Each becomes an auto/bot pick. */
  expiredPicks: number[];
  /** Deadline for the pick left on the clock after resolving expiredPicks; null when complete. */
  nextDeadline: Date | null;
  /** True when resolving expiredPicks finishes the draft. */
  complete: boolean;
};

export function deadlineForTurn(turnStart: Date, isBot: boolean, pickSeconds: number, botPickSeconds: number): Date {
  const seconds = isBot ? botPickSeconds : pickSeconds;
  return new Date(turnStart.getTime() + seconds * 1000);
}

/**
 * Walks the clock forward from the current pick, collecting every turn whose
 * deadline has passed as of `now` — cascades of consecutive bot turns and
 * abandoned human turns resolve in one call. `maxPicks` bounds the batch so
 * the enclosing row-lock transaction stays short; the next poll continues.
 */
export function computeExpiredTurns(state: DraftClockState, now: Date, maxPicks = 20): ExpiredTurns {
  if (state.status !== "in_progress" || state.currentPickDeadline === null) {
    return { expiredPicks: [], nextDeadline: state.currentPickDeadline, complete: false };
  }

  const lastPick = state.rounds * state.teamCount;
  const expiredPicks: number[] = [];
  let pick = state.currentOverallPick;
  let deadline = state.currentPickDeadline;

  while (pick <= lastPick && deadline.getTime() <= now.getTime() && expiredPicks.length < maxPicks) {
    expiredPicks.push(pick);
    pick += 1;

    if (pick > lastPick) {
      return { expiredPicks, nextDeadline: null, complete: true };
    }

    // The next turn starts the moment the previous one expired, so a late
    // poller resolves an entire backlog exactly as it would have played out.
    deadline = deadlineForTurn(deadline, state.onClockIsBot(pick), state.pickSeconds, state.botPickSeconds);
  }

  return { expiredPicks, nextDeadline: deadline, complete: false };
}
