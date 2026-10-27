import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ signup: vi.fn(), ensure: vi.fn(), invite: vi.fn(), enabled: vi.fn(), blocked: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/auth/neon-auth", () => ({ getNeonAuth: () => ({ signUp: { email: mocks.signup } }), ensureOfbUserForNeonAuth: mocks.ensure }));
vi.mock("@/lib/auth/signups", () => ({ areSignupsEnabled: mocks.enabled }));
vi.mock("@/lib/data/league-invites", () => ({ isInviteTokenRedeemable: mocks.invite }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/auth/account-status", () => ({ isAccountBlocked: mocks.blocked }));
import { signUpWithEmail } from "./actions";

const user = { id: "provider", email: "invited@ofb.test" };
function form(invite = "") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ name: "Manager", email: user.email, password: "test-password", invite })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(false); mocks.invite.mockResolvedValue(false); mocks.blocked.mockResolvedValue(false);
  mocks.signup.mockResolvedValue({ data: { user } }); mocks.ensure.mockResolvedValue({ userId: "app-user" });
});
describe("guarded email enrollment", () => {
  it("rejects closed signup before invoking the provider", async () => {
    expect(await signUpWithEmail(null, form())).toMatchObject({ error: "Account creation is currently disabled." });
    expect(mocks.signup).not.toHaveBeenCalled();
  });
  it("provisions an invited user with the explicit token before redirecting to acceptance", async () => {
    mocks.invite.mockResolvedValue(true);
    await expect(signUpWithEmail(null, form("invite-token"))).rejects.toThrow("redirect:/join/invite-token");
    expect(mocks.ensure).toHaveBeenCalledWith(user, undefined, "invite-token");
  });
  it("surfaces provisioning failure instead of treating provider success as OFB enrollment", async () => {
    mocks.enabled.mockReturnValue(true); mocks.ensure.mockResolvedValue(null);
    expect(await signUpWithEmail(null, form())).toMatchObject({ error: expect.stringContaining("could not be completed") });
  });
});
