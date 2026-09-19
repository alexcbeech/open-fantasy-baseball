import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { BrandLockup } from "@/app/brand-lockup";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listAdminRunHistory } from "@/lib/data/admin-runs";
import { listAuditEventPage } from "@/lib/data/audit";
import { listRecentFeedback } from "@/lib/data/feedback";
import { nightlyProcessingTasks, getNightlyProcessingWindow } from "@/lib/jobs/nightly-processing";
import { AdminSection } from "./admin-section";
import { AdminAuditLog } from "./audit-log";
import { AdminOperationsPanel } from "./operations-panel";
import { AdminFeedbackList } from "./feedback-list";
import { AdminAnnouncementsPanel } from "./announcements-panel";
import { AdminUsersPanel } from "./users-panel";

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
  const auditPage = await listAuditEventPage();

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <BrandLockup kicker="Operations" title="Admin" />
        <AuthControl enabled={authEnabled} />
      </header>

      <section className="page admin-page">
        <h1>Admin</h1>
        <AdminOperationsPanel initialHistory={history} />

        <AdminSection title="Nightly Window" id="schedule-heading">
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

        </AdminSection>
        <AdminSection title="Task Plan" id="task-plan-heading">
          <div className="admin-task-list">
            {nightlyProcessingTasks.map((task) => (
              <div className="admin-task-row" key={task}>
                <span className="slot">JOB</span>
                <span>{task}</span>
              </div>
            ))}
          </div>
        </AdminSection>

        <AdminUsersPanel />
        <AdminAnnouncementsPanel />

        <AdminSection title="User Feedback" id="feedback-admin-heading" meta={`${feedback.length} total`}>
          <AdminFeedbackList initialFeedback={feedback} />
        </AdminSection>

        <AdminSection title="Audit Log" id="audit-log-heading" meta="newest first">
          <AdminAuditLog initialEvents={auditPage.events} initialHasMore={auditPage.hasMore} />
        </AdminSection>
      </section>
    </main>
  );
}
