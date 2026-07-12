// Pure season-schedule math: weekly scoring windows, round-robin pairings,
// and playoff sizing. The data layer persists what these functions compute.

export type MatchupPairing = {
  homeTeamId: string;
  awayTeamId: string;
};

export type SeasonPeriodPlan = {
  label: string;
  startsAt: Date;
  endsAt: Date;
  isPlayoff: boolean;
  /** 1-based playoff round; null for regular-season weeks. */
  playoffRound: number | null;
  /** Regular-season pairings; playoff matchups are seeded when rounds begin. */
  matchups: MatchupPairing[];
};

// Week boundaries at 04:00 UTC ≈ midnight ET, matching baseball's "day".
const WEEK_BOUNDARY_UTC_HOUR = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday-04:00-UTC boundary strictly after the given moment. */
function nextMondayBoundary(from: Date): Date {
  const boundary = new Date(from);
  boundary.setUTCHours(WEEK_BOUNDARY_UTC_HOUR, 0, 0, 0);

  if (boundary <= from) {
    boundary.setUTCDate(boundary.getUTCDate() + 1);
  }

  while (boundary.getUTCDay() !== 1) {
    boundary.setUTCDate(boundary.getUTCDate() + 1);
  }

  return boundary;
}

/** The regular season's final boundary: the Monday on/before October 1. */
export function seasonEndBoundary(seasonYear: number): Date {
  const boundary = new Date(Date.UTC(seasonYear, 9, 1, WEEK_BOUNDARY_UTC_HOUR));

  while (boundary.getUTCDay() !== 1) {
    boundary.setUTCDate(boundary.getUTCDate() - 1);
  }

  return boundary;
}

/**
 * The season a newly created league should target: the current calendar year
 * until its fantasy season has ended, then next year. Pre-season moments
 * (spring training) already fall in the upcoming season's calendar year.
 */
export function currentSeasonYear(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now >= seasonEndBoundary(year) ? year + 1 : year;
}

/** Single-elimination rounds needed for a playoff field (0 = no playoffs). */
export function playoffRoundCount(playoffTeamCount: number): number {
  if (playoffTeamCount < 2) {
    return 0;
  }

  return Math.ceil(Math.log2(playoffTeamCount));
}

/**
 * Round-robin pairings for one week (circle method): every team plays one
 * opponent, rotating so the pairings differ each week and repeat every
 * (teamCount - 1) weeks. Odd team counts give one team a weekly bye. Home
 * assignment alternates by week so home/away balances over a season.
 */
export function roundRobinPairs(teamIds: string[], weekIndex: number): MatchupPairing[] {
  if (teamIds.length < 2) {
    return [];
  }

  // Odd counts add a "ghost" seat; whoever draws the ghost has a bye.
  const seats: Array<string | null> = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, null];
  const rounds = seats.length - 1;
  const rotation = weekIndex % rounds;

  // Circle method: fix seat 0, rotate the rest by `rotation`.
  const fixed = seats[0];
  const rest = seats.slice(1);
  const rotated = [...rest.slice(rest.length - rotation), ...rest.slice(0, rest.length - rotation)];
  const ordered = [fixed, ...rotated];

  const pairs: MatchupPairing[] = [];

  for (let index = 0; index < ordered.length / 2; index += 1) {
    const left = ordered[index];
    const right = ordered[ordered.length - 1 - index];

    if (left === null || right === null) {
      continue;
    }

    const homeFirst = (weekIndex + index) % 2 === 0;
    pairs.push(homeFirst ? { homeTeamId: left, awayTeamId: right } : { homeTeamId: right, awayTeamId: left });
  }

  return pairs;
}

export type BuildSeasonScheduleInput = {
  teamIds: string[];
  seasonYear: number;
  playoffTeamCount: number;
  /** Schedule start; the first week runs from here to the next Monday. */
  from: Date;
  /** Continue week numbering after existing periods (e.g. a "Draft Week"). */
  startWeekNumber?: number;
  /** Offset the round-robin rotation by the number of prior weeks, so an
   * extension doesn't repeat the pairings the existing weeks already used. */
  rotationOffset?: number;
};

/**
 * The full remaining season: weekly regular-season periods with round-robin
 * matchups from `from` until the season-end boundary, then one period per
 * playoff round. A first week shorter than two days merges into the following
 * full week so no matchup lasts a single day. Playoff periods are created
 * without matchups — seeding happens when the regular season finalizes. When
 * the calendar leaves too few weeks, extra weeks are appended past the season
 * boundary so every playoff round still gets a period.
 */
export function buildSeasonSchedule(input: BuildSeasonScheduleInput): SeasonPeriodPlan[] {
  const { teamIds, seasonYear, playoffTeamCount, from } = input;
  const playoffRounds = playoffRoundCount(Math.min(playoffTeamCount, teamIds.length));

  const boundaries: Date[] = [new Date(from)];
  let cursor = nextMondayBoundary(from);

  // Merge a stub first week (under two days) into the following full week.
  if (cursor.getTime() - from.getTime() < 2 * DAY_MS) {
    cursor = new Date(cursor.getTime() + 7 * DAY_MS);
  }

  const seasonEnd = seasonEndBoundary(seasonYear);

  while (cursor < seasonEnd) {
    boundaries.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + 7 * DAY_MS);
  }

  boundaries.push(seasonEnd > boundaries[boundaries.length - 1] ? seasonEnd : cursor);

  // Guarantee at least one regular week plus every playoff round.
  while (boundaries.length - 1 < playoffRounds + 1) {
    const last = boundaries[boundaries.length - 1];
    boundaries.push(new Date(last.getTime() + 7 * DAY_MS));
  }

  const periodCount = boundaries.length - 1;
  const regularCount = periodCount - playoffRounds;
  const startWeekNumber = input.startWeekNumber ?? 1;
  const periods: SeasonPeriodPlan[] = [];

  for (let index = 0; index < periodCount; index += 1) {
    const isPlayoff = index >= regularCount;
    const playoffRound = isPlayoff ? index - regularCount + 1 : null;

    periods.push({
      label: isPlayoff
        ? playoffRound === playoffRounds
          ? "Championship"
          : `Playoffs Round ${playoffRound}`
        : `Week ${startWeekNumber + index}`,
      startsAt: boundaries[index],
      endsAt: boundaries[index + 1],
      isPlayoff,
      playoffRound,
      matchups: isPlayoff ? [] : roundRobinPairs(teamIds, index + (input.rotationOffset ?? 0)),
    });
  }

  return periods;
}

export type TeamRecord = {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
};

/** "12-6" or "12-6-2" — ties only shown when they exist. */
export function formatRecord(record: Pick<TeamRecord, "wins" | "losses" | "ties">): string {
  const base = `${record.wins}-${record.losses}`;
  return record.ties > 0 ? `${base}-${record.ties}` : base;
}

/**
 * League standings order: wins, then accumulated points, then name for a
 * stable tie-break. Returns team ids in rank order.
 */
export function rankStandings<T extends TeamRecord & { teamName: string }>(records: T[]): T[] {
  return [...records].sort(
    (a, b) => b.wins - a.wins || b.points - a.points || a.teamName.localeCompare(b.teamName),
  );
}
