// Pure waiver timing math shared by drops (waiver window) and claims
// (processing time).

// Waivers process at 04:00 UTC ≈ midnight ET, the roster day boundary.
const PROCESSING_UTC_HOUR = 4;

/**
 * The next moment waivers process: the earliest strictly-future occurrence of
 * any weekday in `processingDays` (0 = Sunday) at the processing hour. An
 * empty list behaves like every day. This doubles as the waiver window for a
 * just-dropped player: they clear at the next processing time after the drop.
 */
export function nextWaiverProcessingTime(processingDays: number[], now: Date): Date {
  const days = processingDays.length ? new Set(processingDays) : new Set([0, 1, 2, 3, 4, 5, 6]);
  const candidate = new Date(now);
  candidate.setUTCHours(PROCESSING_UTC_HOUR, 0, 0, 0);

  for (let offset = 0; offset < 8; offset += 1) {
    if (candidate > now && days.has(candidate.getUTCDay())) {
      return candidate;
    }

    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate;
}
