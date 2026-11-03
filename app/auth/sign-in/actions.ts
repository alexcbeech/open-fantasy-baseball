"use server";

import { redirect } from "next/navigation";
import { ensureOfbUserForNeonAuth, getNeonAuth } from "@/lib/auth/neon-auth";
import { isAccountBlocked } from "@/lib/auth/account-status";

export type AuthFormState = {
  error: string;
} | null;

export async function signInWithEmail(_previousState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const auth = getNeonAuth();

  if (!auth) {
    return { error: "Neon Auth is not configured." };
  }

  const email = formData.get("email")?.toString().trim();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const next = formData.get("next")?.toString() ?? "";
  const landing = next.startsWith("/join/") ? next : "/";
  let inviteToken: string | null = null;
  try { inviteToken = landing === "/" ? null : decodeURIComponent(landing.slice("/join/".length)); }
  catch { return { error: "This invite link is not valid. Open the link from your invitation again." }; }

  try {
    if (await isAccountBlocked(email)) return { error: "Sign-in is unavailable for this account. Contact an administrator." };
  } catch { return { error: "Sign-in is temporarily unavailable. Please try again shortly." }; }
  // A fresh password authentication began at this time. Using its start time
  // conservatively preserves session revocation if an account changes mid-login.
  const signInStartedAt = new Date();
  const result = await auth.signIn.email({ email, password });

  if (result.error) {
    return { error: result.error.message || "Failed to sign in." };
  }
  // Neon reads getSession() from incoming request headers. The new session
  // cookie is only sent with this response, so it is not available there yet.
  // Check the authenticated identity now; normal access checks run after redirect.
  const user = result.data?.user;
  try {
    if (!user || await isAccountBlocked(user.email, user.id)) {
      await auth.signOut();
      return { error: "Sign-in is unavailable for this account. Contact an administrator." };
    }
    // Resume a provider account whose earlier OFB provisioning failed. The
    // mapper revalidates the invite against the authenticated provider email;
    // a caller-supplied redirect alone never authorizes enrollment.
    if (!(await ensureOfbUserForNeonAuth(user, signInStartedAt, inviteToken))) {
      await auth.signOut();
      return { error: "Account setup could not be completed. Sign in again from your invitation, or contact an administrator." };
    }
  } catch {
    await auth.signOut();
    return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
  }

  // Only league-invite landings may override the post-sign-in destination;
  // the "/join/" prefix check prevents an open redirect.
  redirect(landing);
}
