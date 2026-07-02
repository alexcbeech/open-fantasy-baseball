import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthSetupStatus, getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { SignUpForm } from "./sign-up-form";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const [currentUser, setup] = await Promise.all([getCurrentOfbUser(), Promise.resolve(getAuthSetupStatus())]);

  if (currentUser && isNeonAuthConfigured()) {
    redirect("/");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <div className="brand-lockup">
          <span className="brand-kicker">Open Fantasy</span>
          <span className="brand-title">Create Account</span>
        </div>
        <span className="icon-button" aria-hidden="true">
          +
        </span>
      </header>

      <section className="page auth-page">
        <div className="panel auth-page-panel">
          <h1>Create account</h1>
          <p className="subtle">Create a Neon Auth login for OFB team management and API access.</p>
          {isNeonAuthConfigured() ? <SignUpForm /> : <AuthSetupNotice setup={setup} />}
        </div>
      </section>
    </main>
  );
}

function AuthSetupNotice({ setup }: { setup: ReturnType<typeof getAuthSetupStatus> }) {
  return (
    <div className="auth-form">
      <div className="status-banner bad">Neon Auth needs two local env values before account creation is enabled.</div>
      <div className="setting-list">
        <div className="setting-row">
          <span>NEON_AUTH_BASE_URL</span>
          <strong>{setup.baseUrl ? "set" : "missing"}</strong>
        </div>
        <div className="setting-row">
          <span>NEON_AUTH_COOKIE_SECRET</span>
          <strong>{setup.cookieSecret ? "set" : "missing"}</strong>
        </div>
      </div>
    </div>
  );
}
