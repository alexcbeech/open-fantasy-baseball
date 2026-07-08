"use server";

import { redirect } from "next/navigation";
import { getNeonAuth } from "@/lib/auth/neon-auth";
import { areSignupsEnabled } from "@/lib/auth/signups";
import { isInviteTokenRedeemable } from "@/lib/data/league-invites";
import { isDatabaseConfigured } from "@/lib/db/client";

export type AuthFormState = {
  error: string;
} | null;

export async function signUpWithEmail(_previousState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();
  const inviteToken = formData.get("invite")?.toString().trim() || null;

  if (!name || !email || !password) {
    return { error: "Name, email, and password are required." };
  }

  // A live league invite is the one sanctioned path through the signup gate:
  // the token must be unexpired, unused, and sent to this exact email.
  // Everything else stays blocked while ALLOW_SIGNUPS is off.
  const invitedSignup = Boolean(
    inviteToken && isDatabaseConfigured() && (await isInviteTokenRedeemable(inviteToken, email)),
  );

  // Authoritative guard: blocks account creation even against a direct POST,
  // not just the hidden UI.
  if (!areSignupsEnabled() && !invitedSignup) {
    return { error: "Account creation is currently disabled." };
  }

  const auth = getNeonAuth();

  if (!auth) {
    return { error: "Neon Auth is not configured." };
  }

  const result = await auth.signUp.email({ email, password, name });

  if (result.error) {
    return { error: result.error.message || "Failed to create account." };
  }

  // Invited users land back on the join page to accept; the token is only
  // ever used as a path segment, so this cannot redirect off-site.
  redirect(invitedSignup && inviteToken ? `/join/${encodeURIComponent(inviteToken)}` : "/");
}
