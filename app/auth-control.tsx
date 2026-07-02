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
  if (!enabled) {
    return (
      <Link className="auth-link" href="/auth/sign-in">
        Sign in
      </Link>
    );
  }

  const user = await getCurrentOfbUser();

  if (!user) {
    return (
      <Link className="auth-link" href="/auth/sign-in">
        Sign in
      </Link>
    );
  }

  return (
    <form action={signOutAction} className="auth-user">
      <span className="auth-name">{user.displayName || user.email}</span>
      {user.isAdmin ? <span className="auth-role">Admin</span> : null}
      <button className="auth-signout" type="submit">
        Sign out
      </button>
    </form>
  );
}
