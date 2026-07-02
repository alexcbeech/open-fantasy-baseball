import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listAdminRunHistory } from "@/lib/data/admin-runs";
import { nightlyProcessingTasks, getNightlyProcessingWindow } from "@/lib/jobs/nightly-processing";
import { AdminOperationsPanel } from "./operations-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authEnabled = isNeonAuthConfigured();
  const currentUser = await getCurrentOfbUser();

  if (!currentUser && authEnabled) {
    redirect("/auth/sign-in");
  }

  if (!currentUser?.isAdmin) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <Link className="icon-button" href="/" aria-label="Back to all teams">
            &larr;
          </Link>
          <div className="brand-lockup">
            <span className="brand-kicker">Operations</span>
            <span className="brand-title">Admin</span>
          </div>
          <AuthControl enabled={authEnabled} />
        </header>

        <section className="page">
          <div className="panel">
            <h1>Admin Access Required</h1>
            <p className="subtle">Your current session does not include the Neon Auth admin role.</p>
          </div>
        </section>
      </main>
    );
  }

  const window = getNightlyProcessingWindow();
  const history = await listAdminRunHistory();

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <div className="brand-lockup">
          <span className="brand-kicker">Operations</span>
          <span className="brand-title">Admin</span>
        </div>
        <AuthControl enabled={authEnabled} />
      </header>

      <section className="page">
        <div className="content-grid">
          <AdminOperationsPanel initialHistory={history} />

          <aside className="panel admin-side-panel" aria-labelledby="schedule-heading">
            <h2 id="schedule-heading">Nightly Window</h2>
            <div className="setting-list">
              <div className="setting-row">
                <span>Start</span>
                <strong>{window.localStartTime}</strong>
              </div>
              <div className="setting-row">
                <span>Time Zone</span>
                <strong>{window.timeZone}</strong>
              </div>
              <div className="setting-row">
                <span>Expected</span>
                <strong>{window.expectedDurationMinutes} min</strong>
              </div>
            </div>

            <h2>Task Plan</h2>
            <div className="admin-task-list">
              {nightlyProcessingTasks.map((task) => (
                <div className="admin-task-row" key={task}>
                  <span className="slot">JOB</span>
                  <span>{task}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
