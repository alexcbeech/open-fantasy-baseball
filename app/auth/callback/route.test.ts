import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), signout: vi.fn(), existing: vi.fn(), ensure: vi.fn(), invite: vi.fn() }));
vi.mock("@/lib/auth/neon-auth", () => ({ getNeonAuth: () => ({ getSession: mocks.session, signOut: mocks.signout }), hasExistingOfbAccount: mocks.existing, ensureOfbUserForNeonAuth: mocks.ensure }));
vi.mock("@/lib/auth/signups", () => ({ areSignupsEnabled: () => false }));
vi.mock("@/lib/data/league-invites", () => ({ isInviteTokenRedeemable: mocks.invite }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true }));
import { GET } from "./route";
const user = { id: "provider", email: "invited@ofb.test", emailVerified: true };
const createdAt = "2026-10-27T12:00:00Z";
const request = (next = "/") => new NextRequest(`https://ofb.test/auth/callback?next=${encodeURIComponent(next)}`);
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue({ data: { user, session: { createdAt } } });
  mocks.existing.mockResolvedValue(false); mocks.ensure.mockResolvedValue({ userId: "app-user" }); mocks.invite.mockResolvedValue(false);
});
describe("OAuth callback enrollment", () => {
  it("signs out uninvited new identities while signup is closed", async () => {
    expect((await GET(request())).headers.get("location")).toContain("error=signups-closed");
    expect(mocks.signout).toHaveBeenCalledOnce(); expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it("passes a validated invite to identity mapping and returns to acceptance", async () => {
    mocks.invite.mockResolvedValue(true);
    expect((await GET(request("/join/invite-token"))).headers.get("location")).toBe("https://ofb.test/join/invite-token");
    expect(mocks.ensure).toHaveBeenCalledWith(user, createdAt, "invite-token");
  });
  it("treats malformed invitation encoding as denied enrollment", async () => {
    expect((await GET(request("/join/%ZZ"))).headers.get("location")).toContain("error=signups-closed");
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it("does not let an external destination override existing-user sign-in", async () => {
    mocks.existing.mockResolvedValue(true);
    expect((await GET(request("https://evil.test"))).headers.get("location")).toBe("https://ofb.test/");
  });
});
