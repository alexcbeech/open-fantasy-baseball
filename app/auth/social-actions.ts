"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getNeonAuth } from "@/lib/auth/neon-auth";

export type SocialAuthFormState = {
  error: string;
} | null;

/**
 * Starts the Google OAuth flow. The Neon Auth server answers with Google's
 * consent URL (and sets the challenge cookie the middleware later needs to
 * complete the exchange); we send the browser there. Google hands the user
 * back to /auth/callback, which applies the signup gate before letting a
 * brand-new account through.
 */
export async function signInWithGoogle(
  _previousState: SocialAuthFormState,
  formData: FormData,
): Promise<SocialAuthFormState> {
  const auth = getNeonAuth();

  if (!auth) {
    return { error: "Neon Auth is not configured." };
  }

  // Only league-invite landings may override the post-sign-in destination;
  // the "/join/" prefix check prevents an open redirect.
  const next = formData.get("next")?.toString() ?? "";
  const landing = next.startsWith("/join/") ? next : "/";

  const callbackURL = `${await getRequestOrigin()}/auth/callback?next=${encodeURIComponent(landing)}`;
  const { data, error } = await auth.signIn.social({ provider: "google", callbackURL });

  if (error || !data?.url) {
    return { error: error?.message || "Failed to start Google sign-in." };
  }

  redirect(data.url);
}

/** The OAuth callbackURL must be absolute, so rebuild this app's origin from the request. */
async function getRequestOrigin(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol = headerStore.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");

  return `${protocol}://${host}`;
}
