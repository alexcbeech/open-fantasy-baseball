import { getPool } from "@/lib/db/client";
import { rotoStandings, type RotoStanding } from "@/lib/fantasy/roto";
import { activeLineupStats, computeCategoryValue } from "./matchup-scoring";

/**
 * Rotisserie standings for a league: each team's cumulative category values
 * (from its active lineup's season stats — the same source the H2H category
 * battle uses) ranked per category and summed into roto points.
 */
export async function rotoStandingsForLeague(leagueId: string): Promise<RotoStanding[]> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const teams = await client.query<{ id: string; name: string }>(`select id, name from fantasy_team where league_id = $1`, [
      leagueId,
    ]);
    const categories = await client.query<{ category: string }>(
      `select category from league_stat_category where league_id = $1 order by side, sort_order`,
      [leagueId],
    );
    const categoryNames = categories.rows.map((row) => row.category);

    // Sequential on the single client: pg queues concurrent queries per
    // connection anyway and warns about it.
    const inputs = [];

    for (const team of teams.rows) {
      const stats = await activeLineupStats(client, team.id);
      const values: Record<string, number | null> = {};

      for (const category of categoryNames) {
        values[category] = computeCategoryValue(category, stats);
      }

      inputs.push({ teamId: team.id, teamName: team.name, values });
    }

    return rotoStandings(inputs, categoryNames);
  } finally {
    client.release();
  }
}
