import type { PlayerGameLog } from "./types";

/** Fresh boxscores replace imported versions of the same game, never add to them. */
export function mergePlayerGameLog(stored: PlayerGameLog[], today: PlayerGameLog[] = []): PlayerGameLog[] {
  const freshIds = new Set(today.map((game) => game.gamePk).filter((id) => id !== null));
  const freshDates = new Set(today.map((game) => game.date.slice(0, 10)));
  return [
    ...today,
    ...stored.filter((game) => game.gamePk === null
      ? !freshDates.has(game.date.slice(0, 10))
      : !freshIds.has(game.gamePk)),
  ].sort((left, right) => right.date.localeCompare(left.date));
}
