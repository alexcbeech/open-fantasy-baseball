import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { BrandLockup } from "@/app/brand-lockup";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listAdminRunHistory } from "@/lib/data/admin-runs";
import { listAuditEvents } from "@/lib/data/audit";
import { listRecentFeedback } from "@/lib/data/feedback";
import { nightlyProcessingTasks, getNightlyProcessingWindow } from "@/lib/jobs/nightly-processing";
import { AdminAuditLog } from "./audit-log";
import { AdminOperationsPanel } from "./operations-panel";
import { AdminFeedbackList } from "./feedback-list";

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
          <BrandLockup kicker="Operations" title="Admin" />
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
  const feedback = await listRecentFeedback();
  const auditEvents = await listAuditEvents();

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <BrandLockup kicker="Operations" title="Admin" />
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

        <section className="panel feedback-admin-panel" aria-labelledby="feedback-admin-heading">
          <div className="section-title">
            <h2 id="feedback-admin-heading">User Feedback</h2>
            <span className="subtle">{feedback.length} total</span>
          </div>

          <AdminFeedbackList initialFeedback={feedback} />
        </section>

        <section className="panel feedback-admin-panel" aria-labelledby="audit-log-heading">
          <div className="section-title">
            <h2 id="audit-log-heading">Audit Log</h2>
            <span className="subtle">newest first</span>
          </div>

          <AdminAuditLog initialEvents={auditEvents} />
        </section>
      </section>
    </main>
  );
}
