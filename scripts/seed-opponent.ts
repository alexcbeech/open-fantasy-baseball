import "./load-env.mjs";
import { getPool, isDatabaseConfigured } from "../lib/db/client";

// Draft a real active lineup onto the seeded opponent (Warning Track Power) so
// the active matchup has two full teams to score. Mirrors the home team's
// C/1B/OF/SS + SP/RP starter structure, picking the best available real player
// (by season fan points) for each slot.
const LEAGUE_ID = "00000000-0000-4000-8000-000000000101";
const TEAM_ID = "00000000-0000-4000-8000-000000000302";
const PERIOD_ID = "00000000-0000-4000-8000-000000000201";
const LINEUP_DATE = "2026-06-30";
// Synced pitchers carry only the generic "P" eligibility, so the two pitching
// starters go in P slots (slot labels do not affect category scoring).
const slots = ["C", "1B", "OF", "SS", "P", "P"];

async function main() {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("delete from lineup_entry where team_id = $1", [TEAM_ID]);
    await client.query("delete from roster_entry where team_id = $1", [TEAM_ID]);

    const picked: string[] = [];

    for (const slot of slots) {
      const result = await client.query<{ id: string; full_name: string }>(
        `select p.id, p.full_name
         from player p
         join player_position_eligibility ppe
           on ppe.player_id = p.id and ppe.valid_to is null and ppe.position = $1
         where p.season_fan_points is not null
           and not (p.id = any($2::uuid[]))
           and p.id not in (
             select re.player_id from roster_entry re
             join fantasy_team ft on ft.id = re.team_id
             where ft.league_id = $3 and re.dropped_at is null
           )
         order by p.season_fan_points desc
         limit 1 offset 18`,
        [slot, picked, LEAGUE_ID],
      );
      const player = result.rows[0];
      if (!player) {
        console.warn(`no eligible player found for ${slot}`);
        continue;
      }
      picked.push(player.id);
      await client.query(`insert into roster_entry (team_id, player_id, acquisition_type) values ($1, $2, 'draft')`, [
        TEAM_ID,
        player.id,
      ]);
      await client.query(
        `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot) values ($1, $2, $3, $4, $5)`,
        [TEAM_ID, player.id, PERIOD_ID, LINEUP_DATE, slot],
      );
      console.log(`${slot}: ${player.full_name}`);
    }

    await client.query("commit");
    console.log(`drafted ${picked.length} players onto Warning Track Power`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (isDatabaseConfigured()) {
      await getPool().end();
    }
  });
