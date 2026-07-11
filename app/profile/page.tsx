import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { BrandLockup } from "@/app/brand-lockup";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listApiTokens } from "@/lib/data/api-tokens";
import { getProfilePreferences } from "@/lib/data/profile";
import { ProfilePreferencesForm } from "./profile-preferences-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const currentUser = await getCurrentOfbUser();
  const authEnabled = isNeonAuthConfigured();

  if (!currentUser && authEnabled) {
    redirect("/auth/sign-in");
  }

  if (!currentUser) {
    throw new Error("Profile requires a current user.");
  }

  const [profile, apiTokens] = await Promise.all([getProfilePreferences(currentUser.email), listApiTokens(currentUser.email)]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="icon-button" href="/" aria-label="Back to all teams">
          &larr;
        </Link>
        <BrandLockup kicker="Account" title="Preferences" />
        <AuthControl enabled={authEnabled} />
      </header>

      <section className="page">
        <ProfilePreferencesForm initialProfile={profile} initialApiTokens={apiTokens} />
      </section>
    </main>
  );
}
