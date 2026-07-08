"use server";

import { redirect } from "next/navigation";
import { getNeonAuth } from "@/lib/auth/neon-auth";

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

  const result = await auth.signIn.email({ email, password });

  if (result.error) {
    return { error: result.error.message || "Failed to sign in." };
  }

  // Only league-invite landings may override the post-sign-in destination;
  // the "/join/" prefix check prevents an open redirect.
  const next = formData.get("next")?.toString() ?? "";
  redirect(next.startsWith("/join/") ? next : "/");
}
