import Link from "next/link";
import { LeagueCreateForm } from "./league-create-form";
import { defaultCreateLeagueInput } from "@/lib/fantasy/league-create";
import { defaultHitterCategories, defaultPitcherCategories, defaultRosterSlots } from "@/lib/fantasy/defaults";

export default function NewLeaguePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &lt;
        </Link>
        <div className="brand-lockup">
          <span className="brand-kicker">Commissioner</span>
          <span className="brand-title">Create League</span>
        </div>
        <span className="icon-button" aria-hidden="true">
          B
        </span>
      </header>

      <section className="page">
        <div className="content-grid">
          <LeagueCreateForm defaults={defaultCreateLeagueInput} />

          <aside className="panel">
            <h2>Default Setup</h2>
            <div className="setting-list">
              <div className="setting-row">
                <span>Hitting</span>
                <strong>{defaultHitterCategories.join(", ")}</strong>
              </div>
              <div className="setting-row">
                <span>Pitching</span>
                <strong>{defaultPitcherCategories.join(", ")}</strong>
              </div>
              <div className="setting-row">
                <span>IL</span>
                <strong>{defaultRosterSlots.IL}</strong>
              </div>
              <div className="setting-row">
                <span>Bench</span>
                <strong>{defaultRosterSlots.BN}</strong>
              </div>
              <div className="setting-row">
                <span>Playoffs</span>
                <strong>6 teams</strong>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
