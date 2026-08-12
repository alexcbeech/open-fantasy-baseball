import type { PlayerPool } from "@/lib/fantasy/types";

type PoolTeam = {
  league: string | null;
  division: string | null;
};

// MLB sync stores full division names; seed data may store just the region.
const divisionPoolFilters: Partial<Record<PlayerPool, { league: string; division: string }>> = {
  "al-east": { league: "American", division: "East" },
  "al-central": { league: "American", division: "Central" },
  "al-west": { league: "American", division: "West" },
  "nl-east": { league: "National", division: "East" },
  "nl-central": { league: "National", division: "Central" },
  "nl-west": { league: "National", division: "West" },
};

export function poolFilterConditionSql(pool: PlayerPool, alias = "mt"): string {
  if (pool === "al") return `${alias}.league ilike 'American%'`;
  if (pool === "nl") return `${alias}.league ilike 'National%'`;

  const division = divisionPoolFilters[pool];
  return division
    ? `${alias}.league ilike '${division.league}%' and ${alias}.division ilike '%${division.division}%'`
    : "";
}

export function poolFilterSql(pool: PlayerPool, alias = "mt"): string {
  const condition = poolFilterConditionSql(pool, alias);
  return condition ? `and ${condition}` : "";
}

export function isPlayerInPool(pool: PlayerPool, team: PoolTeam): boolean {
  if (pool === "all") return true;
  if (!team.league) return false;

  if (pool === "al" || pool === "nl") {
    const league = pool === "al" ? "American" : "National";
    return team.league.toLowerCase().startsWith(league.toLowerCase());
  }

  const division = divisionPoolFilters[pool];
  return Boolean(
    division &&
      team.league.toLowerCase().startsWith(division.league.toLowerCase()) &&
      team.division?.toLowerCase().includes(division.division.toLowerCase()),
  );
}
