export const HITTER_POSITION_START_THRESHOLD = 5;
export const HITTER_POSITION_APPEARANCE_THRESHOLD = 10;

const infieldAndCatcherPositions = new Set(["C", "1B", "2B", "3B", "SS"]);
const outfieldPositions = new Set(["LF", "CF", "RF", "OF"]);

export type FieldingUsage = {
  position?: string;
  gamesStarted?: number;
  appearances?: number;
};

export type QualifiedHitterPosition = {
  position: "C" | "1B" | "2B" | "3B" | "SS" | "OF";
  gamesStarted: number;
  appearances: number;
};

function nonNegativeInteger(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value ?? 0)) : 0;
}
/**
 * Convert MLB's fielding positions into OFB's hitter roster positions. The
 * three outfield positions intentionally combine because OFB has one OF slot.
 * DH/UTIL is a lineup slot rather than a defensive position, and pitchers are
 * handled by the separate SP/RP usage rules.
 */
export function normalizeHitterFieldingPosition(position: string | undefined): QualifiedHitterPosition["position"] | null {
  const normalized = position?.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (infieldAndCatcherPositions.has(normalized)) {
    return normalized as QualifiedHitterPosition["position"];
  }
  if (outfieldPositions.has(normalized)) {
    return "OF";
  }
  return null;
}

/** Grant a hitter position after five starts or ten total appearances. */
export function deriveHitterPositionEligibility(usages: FieldingUsage[]): QualifiedHitterPosition[] {
  const totals = new Map<QualifiedHitterPosition["position"], { gamesStarted: number; appearances: number }>();

  for (const usage of usages) {
    const position = normalizeHitterFieldingPosition(usage.position);
    if (!position) {
      continue;
    }
    const current = totals.get(position) ?? { gamesStarted: 0, appearances: 0 };
    current.gamesStarted += nonNegativeInteger(usage.gamesStarted);
    current.appearances += nonNegativeInteger(usage.appearances);
    totals.set(position, current);
  }

  return [...totals.entries()]
    .filter(([, total]) =>
      total.gamesStarted >= HITTER_POSITION_START_THRESHOLD ||
      total.appearances >= HITTER_POSITION_APPEARANCE_THRESHOLD,
    )
    .map(([position, total]) => ({ position, ...total }));
}
