import { IdentityImage } from "@/app/identity-image";
import Link from "next/link";
import { getMatchupBrowser } from "@/lib/data/matchup-browser";
import { LiveMatchup } from "./live-matchup";
import { MatchupPicker } from "./matchup-picker";

const statusLabels = { active: "In progress", final: "Final", scheduled: "Upcoming" };

export async function MatchupBrowser({ leagueId, teamId, periodId, matchupId }: {
  leagueId: string; teamId: string; periodId?: string; matchupId?: string;
}) {
  const { periods, period, matchups, selected, details } = await getMatchupBrowser(leagueId, teamId, periodId, matchupId);
  const href = (id: string, matchup?: string) => `/team/${teamId}?${new URLSearchParams({ tab: "matchup", period: id, ...(matchup ? { matchup } : {}) })}`;
  const index = periods.findIndex((entry) => entry.id === period?.id);
  return <div className="matchup-tab">
    <section className="panel" aria-labelledby="league-matchups-heading">
      <h2 id="league-matchups-heading" className="visually-hidden">Matchup schedule</h2>
      {period ? <>
        <form className="matchup-period-controls" action={`/team/${teamId}`}>
          <input type="hidden" name="tab" value="matchup" />
          <label htmlFor="matchup-period">Scoring period</label>
          <select id="matchup-period" name="period" defaultValue={period.id} key={period.id}>
            {periods.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} · {statusLabels[entry.status]}</option>)}
          </select>
          <button className="secondary-button" type="submit">View</button>
        </form>
        <nav className="matchup-period-links" aria-label="Scoring period navigation">
          {index > 0 ? <Link className="secondary-button" href={href(periods[index - 1].id)}>← Previous</Link> : <span />}
          <span className="subtle">{period.label} · {statusLabels[period.status]}</span>
          {index < periods.length - 1 ? <Link className="secondary-button" href={href(periods[index + 1].id)}>Next →</Link> : <span />}
        </nav>
        <MatchupPicker count={matchups.length} key={`${period.id}:${selected?.id ?? "none"}`}>
        <div className="league-matchup-list">
          {matchups.map((matchup) => <Link key={matchup.id} href={href(period.id, matchup.id)}
            className={`league-matchup-card${selected?.id === matchup.id ? " selected" : ""}`}
            aria-current={selected?.id === matchup.id ? "true" : undefined}>
            <span className="subtle">{statusLabels[matchup.status]}</span>
            <span className="league-matchup-side"><span className="team-image-name"><IdentityImage url={matchup.home_logo_url} name={matchup.home_name} />{matchup.home_name}</span><strong>{matchup.status === "scheduled" ? "—" : Number(matchup.home_score)}</strong></span>
            <span className="league-matchup-side"><span className="team-image-name"><IdentityImage url={matchup.away_logo_url} name={matchup.away_name} />{matchup.away_name}</span><strong>{matchup.status === "scheduled" ? "—" : Number(matchup.away_score)}</strong></span>
          </Link>)}
        </div>
        {!matchups.length ? <p className="empty-state">No matchups scheduled for this scoring period.</p> : null}
        </MatchupPicker>
      </> : <p className="empty-state">No scoring periods scheduled yet.</p>}
    </section>
    {details && selected ? <LiveMatchup key={selected.id} matchup={details} teamId={details.userTeam.id} status={selected.status} /> : null}
  </div>;
}
