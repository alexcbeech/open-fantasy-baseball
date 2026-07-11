import Link from "next/link";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { getLeagueInviteByToken, type PendingLeagueInvite } from "@/lib/data/league-invites";
import { isDatabaseConfigured } from "@/lib/db/client";
import { AuthShell } from "@/app/auth/auth-shell";
import { AcceptInviteForm } from "./accept-invite-form";

export const dynamic = "force-dynamic";

type JoinPageProps = {
  params: Promise<{
    token: string;
  }>;
};

/**
 * Landing page for emailed league-invite links. Accepting is a POST (server
 * action) so the state change never happens on a GET; this page only inspects
 * the invite and routes the visitor to sign-in/sign-up when needed.
 */
export default async function JoinPage({ params }: JoinPageProps) {
  const { token } = await params;

  return (
    <AuthShell kicker="Open Fantasy Baseball" title="League Invite">
      <JoinPanel token={token} />
    </AuthShell>
  );
}

async function JoinPanel({ token }: { token: string }) {
  if (!isDatabaseConfigured()) {
    return <Notice heading="League invites are unavailable" body="This deployment has no database configured." />;
  }

  const invite = await getLeagueInviteByToken(token);

  if (!invite) {
    return (
      <Notice
        heading="This invite link is not valid"
        body="Check that the full link from the email was used, or ask the commissioner for a new invite."
      />
    );
  }

  if (invite.acceptedAt) {
    return (
      <Notice heading="This invite was already used" body="If that was you, your team is waiting on the home page.">
        <Link className="primary-button" href="/">
          Go to my teams
        </Link>
      </Notice>
    );
  }

  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    return (
      <Notice
        heading="This invite has expired"
        body={`Invites last 7 days. Ask ${invite.invitedByName} to send a new one.`}
      />
    );
  }

  const currentUser = await getCurrentOfbUser();

  if (!currentUser) {
    return <SignedOutInvite invite={invite} token={token} />;
  }

  if (currentUser.email.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Notice
        heading="This invite belongs to a different email"
        body={`It was sent to ${invite.email}, but you are signed in as ${currentUser.email}. Sign in with the invited email to accept it.`}
      />
    );
  }

  return (
    <>
      <h1>Join {invite.leagueName}</h1>
      <p className="subtle">
        {invite.invitedByName} invited you ({invite.email}) to join as a manager. You&apos;ll get your own team to run.
      </p>
      <AcceptInviteForm leagueName={invite.leagueName} token={token} />
    </>
  );
}

function SignedOutInvite({ invite, token }: { invite: PendingLeagueInvite; token: string }) {
  return (
    <>
      <h1>Join {invite.leagueName}</h1>
      <p className="subtle">
        {invite.invitedByName} invited {invite.email} to this league. Sign in with that email — or create an account —
        to accept.
      </p>
      <div className="auth-form">
        <Link className="primary-button" href={`/auth/sign-in?next=/join/${encodeURIComponent(token)}`}>
          Sign in
        </Link>
        <Link className="secondary-button" href={`/auth/sign-up?invite=${encodeURIComponent(token)}`}>
          Create account
        </Link>
      </div>
    </>
  );
}

function Notice({ heading, body, children }: { heading: string; body: string; children?: React.ReactNode }) {
  return (
    <>
      <h1>{heading}</h1>
      <p className="subtle">{body}</p>
      {children}
    </>
  );
}
