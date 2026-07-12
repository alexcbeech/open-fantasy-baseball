import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { recordAuditEvent } from "@/lib/data/audit";
import { createLeagueInvite, LeagueInviteError, leagueInviteCreateSchema } from "@/lib/data/league-invites";
import { isDatabaseConfigured } from "@/lib/db/client";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/email";
import { isRateLimited } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

/** Prefer the canonical deploy URL; fall back to the request's own origin (dev). */
function appBaseUrl(request: Request) {
  return process.env.APP_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

function inviteEmail(to: string, leagueName: string, inviterName: string, joinUrl: string) {
  return {
    to,
    subject: `${inviterName} invited you to ${leagueName} on Open Fantasy Baseball`,
    text: [
      `${inviterName} invited you to join the fantasy baseball league "${leagueName}".`,
      "",
      `Accept the invite: ${joinUrl}`,
      "",
      "This link is for you only and expires in 7 days.",
    ].join("\n"),
    html: [
      `<p>${escapeHtml(inviterName)} invited you to join the fantasy baseball league <strong>${escapeHtml(leagueName)}</strong>.</p>`,
      `<p><a href="${joinUrl}">Accept the invite</a></p>`,
      `<p style="color:#667">This link is for you only and expires in 7 days.</p>`,
    ].join("\n"),
  };
}

/** League and display names are user-controlled; escape them for the HTML body. */
function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "commissioner:league");

  if (auth.response) {
    return auth.response;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "League invites require a configured database." }, { status: 503 });
  }

  // Invites send email from our verified domain — cap the rate per inviter so
  // a compromised session can't turn the domain into a spam source.
  if (isRateLimited(`league-invite:${auth.identity.email}`, { limit: 10, windowMs: 60 * 60 * 1000 })) {
    return NextResponse.json({ error: "Too many invites. Please try again later." }, { status: 429 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body with an email is required." }, { status: 400 });
  }

  const parsed = leagueInviteCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invite could not be created.", issues: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  const { leagueId } = await params;

  let invite;

  try {
    invite = await createLeagueInvite(leagueId, parsed.data.email, auth.identity);
  } catch (error) {
    if (error instanceof LeagueInviteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  // The invite is sent inline rather than through the job queue: the queue
  // drains on a cron, which could delay the email by many minutes, and the
  // raw token (a secret) must not sit in a job payload. If email fails, the
  // commissioner still gets the join link to share manually.
  //
  // The raw token appears exactly twice: in the emailed link and in this
  // one-time response.
  const joinUrl = `${appBaseUrl(request)}/join/${invite.token}`;
  const message = inviteEmail(invite.summary.email, invite.summary.leagueName, invite.summary.invitedByName, joinUrl);
  const sendResult = isEmailConfigured()
    ? await sendEmail(message)
    : { ok: false as const, reason: "Email is not configured; share the join link manually." };

  // Never include the invite token: audit rows must not hold secrets.
  void recordAuditEvent({
    action: "league.invite_create",
    actor: auth.identity,
    entityType: "league",
    entityId: leagueId,
    leagueId,
    detail: { invitedEmail: invite.summary.email, emailSent: sendResult.ok },
    request,
  });

  return NextResponse.json(
    {
      invite: invite.summary,
      joinUrl,
      emailSent: sendResult.ok,
      ...(sendResult.ok ? {} : { emailError: sendResult.reason }),
    },
    { status: 201 },
  );
}
