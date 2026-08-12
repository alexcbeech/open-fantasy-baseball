export default function TeamLoading() {
  return (
    <main className="app-shell" aria-busy="true">
      <header className="topbar">
        <span className="icon-button team-loading-back" aria-hidden="true">
          &larr;
        </span>
        <div className="brand-lockup brand-lockup--clip team-loading-brand" aria-hidden="true">
          <span className="team-loading-line team-loading-line--kicker" />
          <span className="team-loading-line team-loading-line--title" />
        </div>
        <span className="team-loading-account" aria-hidden="true" />
      </header>

      <section className="page" aria-label="Loading team">
        <section className="team-hero team-loading-hero" role="status" aria-live="polite">
          <div className="team-loading-status">
            <span className="team-route-spinner" aria-hidden="true" />
            <div>
              <h1>Loading team...</h1>
              <p className="subtle">Fetching roster, matchup, and league details.</p>
            </div>
          </div>
          <div className="team-loading-summary" aria-hidden="true">
            <span className="team-loading-line team-loading-line--wide" />
            <span className="team-loading-line team-loading-line--medium" />
          </div>
        </section>

        <div className="tabbar team-loading-tabs" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span className="team-loading-tab" key={index} />
          ))}
        </div>

        <section className="panel team-loading-panel" aria-hidden="true">
          <span className="team-loading-line team-loading-line--heading" />
          {Array.from({ length: 5 }, (_, index) => (
            <span className="team-loading-row" key={index} />
          ))}
        </section>
      </section>
    </main>
  );
}
