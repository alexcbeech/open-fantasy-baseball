import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthSetupStatus, getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { areSignupsEnabled } from "@/lib/auth/signups";
import { getLeagueInviteByToken } from "@/lib/data/league-invites";
import { isDatabaseConfigured } from "@/lib/db/client";
import { SignUpForm } from "./sign-up-form";

export const dynamic = "force-dynamic";

type SignUpPageProps = {
  searchParams: Promise<{
    invite?: string;
  }>;
};

/** A live league invite opens the signup gate for its recipient (see actions.ts). */
async function getRedeemableInvite(token: string | undefined) {
  if (!token || !isDatabaseConfigured()) {
    return null;
  }

  const invite = await getLeagueInviteByToken(token);

  if (!invite || invite.acceptedAt || new Date(invite.expiresAt).getTime() <= Date.now()) {
    return null;
  }

  return { token, email: invite.email, leagueName: invite.leagueName };
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { invite: inviteToken } = await searchParams;
  const [currentUser, setup, invite] = await Promise.all([
    getCurrentOfbUser(),
    Promise.resolve(getAuthSetupStatus()),
    getRedeemableInvite(inviteToken),
  ]);

  if (currentUser && isNeonAuthConfigured()) {
    redirect(invite ? `/join/${encodeURIComponent(invite.token)}` : "/");
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
        <span className="topbar-spacer" aria-hidden="true" />
      </header>

      <section className="page auth-page">
        <div className="panel auth-page-panel">
          <h1>Create account</h1>
          <p className="subtle">
            {invite
              ? `Create your account to join ${invite.leagueName}. Use ${invite.email} — the invite is tied to it.`
              : "Create a Neon Auth login for OFB team management and API access."}
          </p>
          {!isNeonAuthConfigured() ? (
            <AuthSetupNotice setup={setup} />
          ) : areSignupsEnabled() || invite ? (
            <SignUpForm inviteToken={invite?.token} prefillEmail={invite?.email} />
          ) : (
            <SignupsClosedNotice />
          )}
        </div>
      </section>
    </main>
  );
}

function SignupsClosedNotice() {
  return (
    <div className="auth-form">
      <div className="status-banner bad">
        Account creation is temporarily closed while we finish building OFB. Check back soon.
      </div>
      <Link className="secondary-button" href="/auth/sign-in">
        Back to sign in
      </Link>
    </div>
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
