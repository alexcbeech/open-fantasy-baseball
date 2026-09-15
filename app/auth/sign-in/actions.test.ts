import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), blocked: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth/neon-auth", () => ({
  getNeonAuth: () => ({ signIn: { email: mocks.signIn }, signOut: mocks.signOut }),
  getCurrentOfbUser: mocks.session,
}));
vi.mock("@/lib/auth/account-status", () => ({ isAccountBlocked: mocks.blocked }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { signInWithEmail } from "./actions";

function form(next = "") {
  const data = new FormData();
  data.set("email", "active@example.test");
  data.set("password", "test-password");
  data.set("next", next);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.blocked.mockResolvedValue(false);
  mocks.session.mockResolvedValue(null);
  mocks.signIn.mockResolvedValue({ data: { user: { id: "provider-id", email: "active@example.test" } }, error: null });
});
describe("email sign-in session handoff", () => {
  it("accepts a successful fresh login when the incoming request has no session", async () => {
    await expect(signInWithEmail(null, form())).rejects.toThrow("redirect:/");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.blocked).toHaveBeenLastCalledWith("active@example.test", "provider-id");
  });
  it("blocks inactive accounts before authenticating", async () => {
    mocks.blocked.mockResolvedValue(true);
    expect(await signInWithEmail(null, form())).toMatchObject({ error: expect.stringContaining("Contact an administrator") });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("checks the returned stable identity and signs out if it became blocked", async () => {
    mocks.blocked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await signInWithEmail(null, form())).toMatchObject({ error: expect.stringContaining("Contact an administrator") });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("fails closed with a temporary error if the post-login status query fails", async () => {
    mocks.blocked.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline"));
    expect(await signInWithEmail(null, form())).toMatchObject({ error: expect.stringContaining("temporarily unavailable") });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
  it("preserves invite redirects while rejecting external destinations", async () => {
    await expect(signInWithEmail(null, form("/join/invite"))).rejects.toThrow("redirect:/join/invite");
    await expect(signInWithEmail(null, form("https://example.test"))).rejects.toThrow("redirect:/");
  });
});
