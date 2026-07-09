"use server";

import { redirect } from "next/navigation";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { acceptLeagueInvite, LeagueInviteError } from "@/lib/data/league-invites";
import { isDatabaseConfigured } from "@/lib/db/client";

export type AcceptInviteState = {
  error: string;
} | null;

export async function acceptInvite(_previousState: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const token = formData.get("token")?.toString();

  if (!token) {
    return { error: "This invite link is not valid." };
  }

  if (!isDatabaseConfigured()) {
    return { error: "League invites require a configured database." };
  }

  const currentUser = await getCurrentOfbUser();

  if (!currentUser) {
    return { error: "Sign in to accept this invite." };
  }

  try {
    await acceptLeagueInvite(token, { email: currentUser.email, displayName: currentUser.displayName });
  } catch (error) {
    if (error instanceof LeagueInviteError) {
      return { error: error.message };
    }

    throw error;
  }

  // Home lists the user's teams, including the one this invite just created.
  redirect("/");
}
