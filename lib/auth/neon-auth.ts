import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { getPool, tryDatabase } from "@/lib/db/client";
import { demoUserEmail } from "@/lib/data/profile";
import { hasAdminRole, normalizeAuthRoles } from "@/lib/auth/roles";

export type OfbCurrentUser = {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  authProvider: "demo" | "neon-auth";
  providerSubject: string | null;
  roles: string[];
  isAdmin: boolean;
};

type AppUserRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

type NeonAuthUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | string[] | null;
  roles?: string[] | null;
};

let neonAuth: NeonAuth | null | undefined;

export function isNeonAuthConfigured() {
  return Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);
}

export function getNeonAuth() {
  if (!isNeonAuthConfigured()) {
    return null;
  }

  neonAuth ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: {
      secret: process.env.NEON_AUTH_COOKIE_SECRET!,
      sessionDataTtl: 300,
    },
    logLevel: process.env.NODE_ENV === "test" ? "silent" : "warn",
  });

  return neonAuth;
}

export async function getCurrentOfbUser(): Promise<OfbCurrentUser | null> {
  const auth = getNeonAuth();

  if (!auth) {
    // The demo fallback user is an admin. Handing it out in production would
    // turn a missing env var into an auth bypass, so fail closed there and
    // keep demo mode for local development and tests.
    if (process.env.NODE_ENV === "production") {
      return null;
    }

    return getDemoCurrentUser();
  }

  const { data: session } = await auth.getSession();
  const authUser = session?.user as NeonAuthUser | undefined;

  if (!authUser?.email) {
    return null;
  }

  return ensureOfbUserForNeonAuth(authUser);
}

export function getAuthSetupStatus() {
  return {
    baseUrl: Boolean(process.env.NEON_AUTH_BASE_URL),
    cookieSecret: Boolean(process.env.NEON_AUTH_COOKIE_SECRET),
  };
}

export async function getCurrentOfbUserOrDemo(): Promise<OfbCurrentUser> {
  return (await getCurrentOfbUser()) ?? getDemoCurrentUser();
}

/**
 * Whether a Neon Auth user already has an OFB account (an app_user row by
 * email, or a linked identity by provider subject). The OAuth callback uses
 * this to tell sign-in apart from account creation while signups are closed.
 * Fails closed: an unreachable database reports "no account".
 */
export async function hasExistingOfbAccount(email: string, providerSubject: string): Promise<boolean> {
  return tryDatabase(
    async () => {
      const result = await getPool().query(
        `select 1 from app_user where email = $1
         union all
         select 1 from auth_identity where provider = 'neon-auth' and provider_subject = $2
         limit 1`,
        [email, providerSubject],
      );

      return (result.rowCount ?? 0) > 0;
    },
    () => false,
  );
}

async function ensureOfbUserForNeonAuth(authUser: NeonAuthUser): Promise<OfbCurrentUser> {
  return tryDatabase(
    async () => {
      const client = await getPool().connect();

      try {
        await client.query("begin");
        const displayName = authUser.name?.trim() || authUser.email.split("@")[0] || "OFB Manager";
        const roles = normalizeAuthRoles(authUser);
        const userResult = await client.query<AppUserRow>(
          `insert into app_user (email, display_name, avatar_url)
           values ($1, $2, $3)
           on conflict (email) do update set
             avatar_url = coalesce(excluded.avatar_url, app_user.avatar_url),
             updated_at = now()
           returning id, email, display_name, avatar_url`,
          [authUser.email, displayName, authUser.image],
        );
        const user = userResult.rows[0];

        await client.query(
          `insert into auth_identity (user_id, provider, provider_subject)
           values ($1, 'neon-auth', $2)
           on conflict (provider, provider_subject) do update set user_id = excluded.user_id`,
          [user.id, authUser.id],
        );
        await client.query(
          `insert into user_preference (user_id, notification_settings)
           values ($1, '{"injuries": true, "trades": true, "waivers": true, "lineupAlerts": false, "displayMode": "auto"}'::jsonb)
           on conflict (user_id) do nothing`,
          [user.id],
        );

        await client.query("commit");

        return {
          userId: user.id,
          email: user.email,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          authProvider: "neon-auth",
          providerSubject: authUser.id,
          roles,
          isAdmin: hasAdminRole(roles),
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    () => ({
      userId: authUser.id,
      email: authUser.email,
      displayName: authUser.name?.trim() || authUser.email.split("@")[0] || "OFB Manager",
      avatarUrl: authUser.image ?? null,
      authProvider: "neon-auth",
      providerSubject: authUser.id,
      roles: normalizeAuthRoles(authUser),
      isAdmin: hasAdminRole(normalizeAuthRoles(authUser)),
    }),
  );
}

function getDemoCurrentUser(): OfbCurrentUser {
  return {
    userId: "demo-user",
    email: demoUserEmail,
    displayName: "Alex",
    avatarUrl: null,
    authProvider: "demo",
    providerSubject: null,
    roles: ["admin"],
    isAdmin: true,
  };
}
