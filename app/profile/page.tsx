import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthControl } from "@/app/auth-control";
import { BrandLockup } from "@/app/brand-lockup";
import { getCurrentOfbUser, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { listApiTokens } from "@/lib/data/api-tokens";
import { getProfilePreferences } from "@/lib/data/profile";
import { ProfilePreferencesForm } from "./profile-preferences-form";
import { ImageUploader } from "@/app/image-uploader";
import { isImageStorageConfigured } from "@/lib/images/storage";
import { isDatabaseConfigured } from "@/lib/db/client";

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
        <section className="panel" aria-label="Profile picture">
          <h2>Profile picture</h2>
          <ImageUploader key={profile.avatarUrl} endpoint="/api/v1/profile/image" initialUrl={profile.avatarUrl}
            name={profile.displayName} label="Profile picture" enabled={isImageStorageConfigured() && isDatabaseConfigured()} />
        </section>
        <ProfilePreferencesForm initialProfile={profile} initialApiTokens={apiTokens} />
      </section>
    </main>
  );
}
