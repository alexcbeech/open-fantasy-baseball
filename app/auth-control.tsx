import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentOfbUser, getNeonAuth } from "@/lib/auth/neon-auth";

async function signOutAction() {
  "use server";

  const auth = getNeonAuth();

  if (auth) {
    await auth.signOut();
  }

  redirect("/auth/sign-in");
}

export async function AuthControl({ enabled }: { enabled: boolean }) {
  const user = await getCurrentOfbUser();

  if (!user) {
    return (
      <Link className="auth-link" href="/auth/sign-in">
        Sign in
      </Link>
    );
  }

  const roleLabel = enabled ? (user.isAdmin ? "Admin" : null) : "Demo";

  // Without Neon Auth configured the app runs as a demo user, so there is no
  // session to sign out of; show who you are instead of a dead sign-in link.
  if (!enabled) {
    return (
      <div className="auth-user">
        <span className="auth-name">{user.displayName || user.email}</span>
        {roleLabel ? <span className="auth-role">{roleLabel}</span> : null}
      </div>
    );
  }

  return (
    <form action={signOutAction} className="auth-user">
      <span className="auth-name">{user.displayName || user.email}</span>
      {roleLabel ? <span className="auth-role">{roleLabel}</span> : null}
      <button className="auth-signout" type="submit">
        Sign out
      </button>
    </form>
  );
}
