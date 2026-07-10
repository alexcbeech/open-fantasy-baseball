// Pure playoff-bracket math: re-seeded single elimination. Each round the
// surviving teams are sorted by their original seed; the field is trimmed to
// the round's target by pairing best-vs-worst among the teams that must play,
// with byes going to the top seeds when the field isn't a power of two.

export type PlayoffTeam = {
  teamId: string;
  seed: number;
};

export type PlayoffRoundPlan = {
  byes: PlayoffTeam[];
  pairs: Array<{ home: PlayoffTeam; away: PlayoffTeam }>;
};

/** How many teams survive after a given 1-based round of `totalRounds`. */
export function survivorsAfterRound(totalRounds: number, round: number): number {
  return 2 ** (totalRounds - round);
}

/**
 * Pair one playoff round. `targetAfter` teams survive: the top seeds take
 * byes when the alive field is short of double the target, everyone else
 * pairs best-vs-worst (home = better seed).
 */
export function pairPlayoffRound(alive: PlayoffTeam[], targetAfter: number): PlayoffRoundPlan {
  const ordered = [...alive].sort((a, b) => a.seed - b.seed);
  const eliminations = Math.max(ordered.length - targetAfter, 0);
  const playing = eliminations * 2;
  const byes = ordered.slice(0, Math.max(ordered.length - playing, 0));
  const field = ordered.slice(byes.length);
  const pairs: PlayoffRoundPlan["pairs"] = [];

  for (let index = 0; index < field.length / 2; index += 1) {
    pairs.push({ home: field[index], away: field[field.length - 1 - index] });
  }

  return { byes, pairs };
}

/**
 * The winner of a playoff matchup: higher score, with the better original
 * seed advancing on a tie (a deterministic, standings-earned tiebreak).
 */
export function playoffWinner(
  home: PlayoffTeam & { score: number },
  away: PlayoffTeam & { score: number },
): PlayoffTeam {
  if (home.score !== away.score) {
    return home.score > away.score ? home : away;
  }

  return home.seed < away.seed ? home : away;
}
