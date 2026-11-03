import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), pooledQuery: vi.fn(), release: vi.fn(),
  signup: vi.fn(), signin: vi.fn(), signout: vi.fn(), session: vi.fn() }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: () => ({
  signUp: { email: mocks.signup }, signIn: { email: mocks.signin }, signOut: mocks.signout, getSession: mocks.session,
}) }));
vi.mock("@/lib/data/profile", () => ({ demoUserEmail: "demo@ofb.test" }));
vi.mock("@/lib/data/draft-order", () => ({ appendTeamToSetupDraft: vi.fn() }));
vi.mock("@/lib/auth/bearer-token", () => ({ hashToken: (token: string) => `hash:${token}` }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ connect: mocks.connect }), query: mocks.pooledQuery,
  isDatabaseConfigured: () => true, isUuid: () => true, isUniqueViolation: () => false,
  tryDatabase: async (operation: () => Promise<unknown>, fallback: () => unknown) => { try { return await operation(); } catch { return fallback(); } },
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { ensureOfbUserForNeonAuth, getCurrentOfbUser } from "./neon-auth";
import { signUpWithEmail } from "@/app/auth/sign-up/actions";
import { signInWithEmail } from "@/app/auth/sign-in/actions";

const provider = { id: "provider-user", email: "invited@ofb.test", emailVerified: true };
let account: Record<string, unknown> | null;
let connectionHeld: boolean;
let providerCreated: boolean;
let failInsert: boolean;
let inviteEmail: string;
function form(token = "valid-invite") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: "Invited", email: provider.email, password: "test-password", invite: token, next: `/join/${token}` })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ALLOW_SIGNUPS", "false");
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://auth.example.invalid");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "test-only-cookie-secret-at-least-32-characters");
  account = null; connectionHeld = false; providerCreated = false; failInsert = false; inviteEmail = provider.email;
  mocks.connect.mockImplementation(async () => {
    if (connectionHeld) throw new Error("Single-connection pool is exhausted");
    connectionHeld = true;
    return { query: mocks.query, release: mocks.release };
  });
  mocks.release.mockImplementation(() => { connectionHeld = false; });
  mocks.pooledQuery.mockImplementation(async (...args) => {
    if (connectionHeld) throw new Error("Invite lookup attempted a second connection");
    return mocks.query(...args);
  });
  mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("as blocked")) return { rows: [{ blocked: false }] };
    if (sql.startsWith("select u.*")) return { rows: account ? [account] : [] };
    if (sql.includes("from league_invite")) return { rows: values[0] === "hash:valid-invite" ? [{ id: "invite", league_id: "league", league_name: "Test", email: inviteEmail,
      invited_by_name: "Commissioner", expires_at: "2099-01-01", expired: false, accepted_at: null }] : [] };
    if (sql.startsWith("insert into app_user")) {
      if (failInsert) { failInsert = false; throw new Error("Transient database failure"); }
      account = { id: "ofb-user", email: provider.email, display_name: "Invited", avatar_url: null,
        identity_linked: true, deactivated_at: null, sessions_valid_after: null };
      return { rows: [account] };
    }
    return { rows: [] };
  });
  mocks.signup.mockImplementation(async () => {
    if (providerCreated) return { error: { message: "User already exists" } };
    providerCreated = true;
    return { data: { user: provider } };
  });
  mocks.signin.mockResolvedValue({ data: { user: provider } });
  mocks.session.mockResolvedValue({ data: { user: provider, session: { createdAt: new Date() } } });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("invited enrollment with a bounded pool", () => {
  it("completes enrollment using only the checked-out connection", async () => {
    expect(await ensureOfbUserForNeonAuth(provider, undefined, "valid-invite")).toMatchObject({ userId: "ofb-user" });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.pooledQuery).not.toHaveBeenCalled();
    expect(connectionHeld).toBe(false);
  });
  it("recovers email enrollment after provider creation and a transient OFB failure", async () => {
    failInsert = true;
    expect(await signUpWithEmail(null, form())).toMatchObject({ error: expect.stringContaining("Use Sign in") });
    expect(account).toBeNull();
    expect(providerCreated).toBe(true);
    expect(await signUpWithEmail(null, form())).toMatchObject({ error: "User already exists" });
    await expect(signInWithEmail(null, form())).rejects.toThrow("redirect:/join/valid-invite");
    expect(await getCurrentOfbUser()).toMatchObject({ userId: "ofb-user" });
    expect(mocks.signout).not.toHaveBeenCalled();
    expect(connectionHeld).toBe(false);
  });
  it.each(["expired-invite", "valid-invite"])("does not resume enrollment with an invalid or mismatched invite: %s", async token => {
    inviteEmail = "different@ofb.test";
    expect(await signInWithEmail(null, form(token))).toMatchObject({ error: expect.stringContaining("Account setup could not be completed") });
    expect(account).toBeNull();
    expect(mocks.signout).toHaveBeenCalledOnce();
  });
  it("preserves revocation if an account changes while password authentication is in progress", async () => {
    await ensureOfbUserForNeonAuth(provider, undefined, "valid-invite");
    mocks.signin.mockImplementation(async () => {
      account!.sessions_valid_after = new Date(Date.now() + 1000);
      return { data: { user: provider } };
    });
    expect(await signInWithEmail(null, form())).toMatchObject({ error: expect.stringContaining("Account setup could not be completed") });
    expect(mocks.signout).toHaveBeenCalledOnce();
  });
});
