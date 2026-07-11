import Link from "next/link";
import { BrandLockup } from "@/app/brand-lockup";
import { LeagueCreateForm } from "./league-create-form";
import { defaultCreateLeagueInput } from "@/lib/fantasy/league-create";
import { defaultHitterCategories, defaultPitcherCategories } from "@/lib/fantasy/defaults";

export default function NewLeaguePage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <BrandLockup kicker="Commissioner" title="Create League" />
        <span className="topbar-spacer" aria-hidden="true" />
      </header>

      <section className="page">
        <div className="content-grid">
          <LeagueCreateForm defaults={defaultCreateLeagueInput} />

          <aside className="panel">
            <h2>Scoring Categories</h2>
            <p className="subtle">Roster slots, player pool, and playoff teams are set in the form. Categories use the OFB defaults.</p>
            <div className="setting-list">
              <div className="setting-row">
                <span>Hitting</span>
                <strong>{defaultHitterCategories.join(", ")}</strong>
              </div>
              <div className="setting-row">
                <span>Pitching</span>
                <strong>{defaultPitcherCategories.join(", ")}</strong>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
