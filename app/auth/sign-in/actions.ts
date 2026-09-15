"use server";

import { redirect } from "next/navigation";
import { getNeonAuth } from "@/lib/auth/neon-auth";
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

  try {
    if (await isAccountBlocked(email)) return { error: "Sign-in is unavailable for this account. Contact an administrator." };
  } catch { return { error: "Sign-in is temporarily unavailable. Please try again shortly." }; }
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
  } catch {
    await auth.signOut();
    return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
  }

  // Only league-invite landings may override the post-sign-in destination;
  // the "/join/" prefix check prevents an open redirect.
  const next = formData.get("next")?.toString() ?? "";
  redirect(next.startsWith("/join/") ? next : "/");
}
