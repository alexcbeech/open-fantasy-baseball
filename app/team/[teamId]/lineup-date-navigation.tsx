import Link from "next/link";
import { AutoNavigateForm } from "@/app/auto-navigate-form";
import { shiftLineupDate } from "@/lib/fantasy/lineup-date";

export function LineupDateNavigation({ teamId, date, today }: { teamId: string; date: string; today: string }) {
  const href = (day: string) => `/team/${teamId}?date=${day}`;
  return <section className="panel" aria-label="Lineup date navigation">
    <AutoNavigateForm action={`/team/${teamId}`}>
      <label htmlFor="lineup-date">Lineup date</label>
      <input id="lineup-date" type="date" name="date" defaultValue={date} key={date} required />
    </AutoNavigateForm>
    <nav className="matchup-period-links" aria-label="Lineup days">
      <Link className="secondary-button" href={href(shiftLineupDate(date, -1))}>← Previous day</Link>
      <Link className="secondary-button" href={href(today)}>Today</Link>
      <Link className="secondary-button" href={href(shiftLineupDate(date, 1))}>Next day →</Link>
    </nav>
    <p className="subtle">{date < today ? "Past lineup · locked" : date === today ? "Today's lineup" : "Future lineup · changes apply from this day until the next saved lineup."}</p>
    {date > today ? <p className="subtle">Roster adds, drops, and trades reset saved future lineups to your updated roster.</p> : null}
  </section>;
}
