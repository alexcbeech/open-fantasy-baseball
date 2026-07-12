import { NextResponse, type NextRequest } from "next/server";
import { getNeonAuth, hasExistingOfbAccount } from "@/lib/auth/neon-auth";
import { areSignupsEnabled } from "@/lib/auth/signups";
import { isInviteTokenRedeemable } from "@/lib/data/league-invites";
import { isDatabaseConfigured } from "@/lib/db/client";

/**
 * Where the browser lands after an OAuth round trip (the middleware has
 * already exchanged the session verifier for cookies by the time we run).
 * Email sign-up enforces the ALLOW_SIGNUPS gate in its server action, but a
 * brand-new Google user gets their session minted upstream during the OAuth
 * callback -- so the equivalent gate has to run here, after the fact: no
 * existing OFB account and no live invite means sign the session back out.
 */
export async function GET(request: NextRequest) {
  const requestUrl = request.nextUrl;
  // Only league-invite landings may override the destination (no open redirect).
  const next = requestUrl.searchParams.get("next") ?? "";
  const landing = next.startsWith("/join/") ? next : "/";
  const auth = getNeonAuth();

  if (!auth) {
    return NextResponse.redirect(new URL("/auth/sign-in", requestUrl));
  }

  const { data: session } = await auth.getSession();
  const user = session?.user;

  if (!user?.email) {
    return NextResponse.redirect(new URL("/auth/sign-in?error=google", requestUrl));
  }

  const email = user.email;

  if (!areSignupsEnabled() && !(await hasExistingOfbAccount(email, user.id))) {
    // A live league invite is the one sanctioned path through the signup
    // gate, same as email sign-up -- and it must be addressed to the email
    // Google just vouched for.
    const inviteToken = landing.startsWith("/join/") ? decodeURIComponent(landing.slice("/join/".length)) : "";
    const invitedSignup = Boolean(
      inviteToken && isDatabaseConfigured() && (await isInviteTokenRedeemable(inviteToken, email)),
    );

    if (!invitedSignup) {
      await auth.signOut();
      return NextResponse.redirect(new URL("/auth/sign-in?error=signups-closed", requestUrl));
    }
  }

  return NextResponse.redirect(new URL(landing, requestUrl));
}
