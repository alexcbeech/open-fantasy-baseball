// Pure rotisserie standings math. Each category ranks every team; the best
// value earns teamCount points down to 1 for the worst, with ties splitting
// the points they span. A team's roto total is the sum across categories.

const lowerIsBetter = new Set(["ERA", "WHIP"]);

export type RotoTeamInput = {
  teamId: string;
  teamName: string;
  /** Cumulative category values; null when a rate stat has no denominator. */
  values: Record<string, number | null>;
};

export type RotoStanding = {
  teamId: string;
  teamName: string;
  rank: number;
  points: number;
  /** Per-category points earned, for detail displays. */
  categoryPoints: Record<string, number>;
};

/**
 * Points every team earns in one category. Ties split the points for the
 * positions they occupy (two teams tied for 1st of 4 each get (4+3)/2). A
 * null value (no at-bats/innings yet) always ranks below every real value.
 */
export function categoryPoints(
  category: string,
  values: Array<{ teamId: string; value: number | null }>,
): Map<string, number> {
  const teamCount = values.length;
  const direction = lowerIsBetter.has(category) ? 1 : -1;
  const sorted = [...values].sort((a, b) => {
    if (a.value === null && b.value === null) {
      return 0;
    }
    if (a.value === null) {
      return 1;
    }
    if (b.value === null) {
      return -1;
    }
    return (a.value - b.value) * direction;
  });

  const points = new Map<string, number>();
  let index = 0;

  while (index < sorted.length) {
    // Group ties (including the all-null tail) and average their positions.
    let end = index;

    while (
      end + 1 < sorted.length &&
      ((sorted[end + 1].value === null && sorted[index].value === null) ||
        (sorted[end + 1].value !== null && sorted[index].value !== null && sorted[end + 1].value === sorted[index].value))
    ) {
      end += 1;
    }

    // Positions index..end (0-based); position p earns teamCount - p points.
    const total = Array.from({ length: end - index + 1 }, (_, offset) => teamCount - (index + offset)).reduce(
      (sum, value) => sum + value,
      0,
    );
    const share = total / (end - index + 1);

    for (let position = index; position <= end; position += 1) {
      points.set(sorted[position].teamId, share);
    }

    index = end + 1;
  }

  return points;
}

/** Full roto standings: per-category points summed and ranked. */
export function rotoStandings(teams: RotoTeamInput[], categories: string[]): RotoStanding[] {
  const totals = new Map<string, { points: number; byCategory: Record<string, number> }>(
    teams.map((team) => [team.teamId, { points: 0, byCategory: {} }]),
  );

  for (const category of categories) {
    const earned = categoryPoints(
      category,
      teams.map((team) => ({ teamId: team.teamId, value: team.values[category] ?? null })),
    );

    for (const [teamId, points] of earned) {
      const entry = totals.get(teamId)!;
      entry.points += points;
      entry.byCategory[category] = points;
    }
  }

  const ranked = [...teams].sort((a, b) => {
    const diff = totals.get(b.teamId)!.points - totals.get(a.teamId)!.points;
    return diff !== 0 ? diff : a.teamName.localeCompare(b.teamName);
  });

  return ranked.map((team, index) => ({
    teamId: team.teamId,
    teamName: team.teamName,
    rank: index + 1,
    points: Math.round(totals.get(team.teamId)!.points * 10) / 10,
    categoryPoints: totals.get(team.teamId)!.byCategory,
  }));
}
