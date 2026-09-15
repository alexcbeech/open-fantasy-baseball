"use server";

import { redirect } from "next/navigation";
import { getCurrentOfbUser, getNeonAuth } from "@/lib/auth/neon-auth";
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
  if (!(await getCurrentOfbUser())) {
    await auth.signOut();
    return { error: "Sign-in is unavailable for this account. Contact an administrator." };
  }

  // Only league-invite landings may override the post-sign-in destination;
  // the "/join/" prefix check prevents an open redirect.
  const next = formData.get("next")?.toString() ?? "";
  redirect(next.startsWith("/join/") ? next : "/");
}
