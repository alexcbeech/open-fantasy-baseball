import { redirect } from "next/navigation";
import { getAuthSetupStatus, getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { areSignupsEnabled } from "@/lib/auth/signups";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { next: rawNext } = await searchParams;
  // Only league-invite landings may override the destination (no open redirect).
  const next = rawNext?.startsWith("/join/") ? rawNext : undefined;
  const [currentUser, setup] = await Promise.all([getCurrentOfbUser(), Promise.resolve(getAuthSetupStatus())]);

  if (currentUser && isNeonAuthConfigured()) {
    redirect(next ?? "/");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup brand-lockup--logo brand-lockup--auth">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/brand/ofb-mark.svg" alt="" width={56} height={56} aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-kicker">Open Fantasy</span>
            <span className="brand-title">Baseball</span>
          </span>
        </div>
      </header>

      <section className="page auth-page">
        <div className="panel auth-page-panel">
          <h1>Sign in</h1>
          {isNeonAuthConfigured() ? (
            <SignInForm next={next} signupsEnabled={areSignupsEnabled()} />
          ) : (
            <AuthSetupNotice setup={setup} />
          )}
        </div>
      </section>
    </main>
  );
}

function AuthSetupNotice({ setup }: { setup: ReturnType<typeof getAuthSetupStatus> }) {
  return (
    <div className="auth-form">
      <div className="status-banner bad">Neon Auth needs two local env values before browser sign-in is enabled.</div>
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
