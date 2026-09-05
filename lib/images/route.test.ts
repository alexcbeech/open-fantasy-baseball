import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), replace: vi.fn(), put: vi.fn(), remove: vi.fn(), audit: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/auth/api-identity", () => ({ resolveApiIdentity: mocks.auth }));
vi.mock("@/lib/auth/team-access", () => ({ requireTeamManager: mocks.access }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, isUuid: () => true }));
vi.mock("@/lib/data/images", () => ({ replaceImage: mocks.replace }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("./storage", () => ({ isImageStorageConfigured: mocks.configured, storeImage: mocks.put, removeStoredImage: mocks.remove }));
import { handleImageRequest } from "./route";
import { resetRateLimiter } from "@/lib/rate-limit";
import sharp from "sharp";

beforeEach(() => {
  vi.clearAllMocks(); resetRateLimiter();
  mocks.auth.mockResolvedValue({ identity: { userId: "owner", email: "owner@example.test" }, response: null });
  mocks.access.mockResolvedValue(null); mocks.configured.mockReturnValue(true);
  mocks.put.mockResolvedValue({ url: "https://store.public.blob.vercel-storage.com/new.webp" });
  mocks.replace.mockResolvedValue("old-url"); mocks.remove.mockResolvedValue(undefined);
});
const request = (method = "DELETE") => new Request("https://app.test/api/v1/profile/image", { method });
describe("image mutation routes", () => {
  it("requires authentication and preserves scope denials", async () => {
    for (const status of [401, 403]) {
      mocks.auth.mockResolvedValueOnce({ response: new Response(null, { status }) });
      expect((await handleImageRequest(request())).status).toBe(status);
    }
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "write:profile");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("denies logo changes to non-managers before storage", async () => {
    mocks.access.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await handleImageRequest(request(), "another-team")).status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "write:team");
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("blocks cross-origin browser mutations", async () => {
    expect((await handleImageRequest(new Request("https://app.test/upload", { method: "DELETE", headers: { Origin: "https://other.test" } }))).status).toBe(403);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
  it("rate limits mutations per account", async () => {
    for (let index = 0; index < 10; index++) expect((await handleImageRequest(request())).status).toBe(200);
    expect((await handleImageRequest(request())).status).toBe(429);
    expect(mocks.replace).toHaveBeenCalledTimes(10);
  });
  it("stores only processed bytes, records the authenticated owner, and cleans the previous image", async () => {
    const png = await sharp({ create: { width: 800, height: 800, channels: 3, background: "blue" } }).png().toBuffer();
    const response = await handleImageRequest(new Request("https://app.test/upload?userId=other", { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array(png) }));
    expect(response.status).toBe(200);
    const [target, image] = mocks.put.mock.calls[0];
    expect(target).toEqual({ kind: "profile", id: "owner" });
    expect(await sharp(image).metadata()).toMatchObject({ format: "webp", width: 256, height: 256 });
    expect(mocks.remove).toHaveBeenCalledWith(target, "old-url");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "profile.image.upload", actor: { userId: "owner", email: "owner@example.test" } }));
  });
  it("audits removal and fails clearly when storage is unavailable", async () => {
    expect((await handleImageRequest(request(), "team")).status).toBe(200);
    expect(mocks.replace).toHaveBeenCalledWith({ kind: "team", id: "team" }, null);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "team.image.remove", teamId: "team" }));
    mocks.configured.mockReturnValue(false);
    expect((await handleImageRequest(request())).status).toBe(503);
  });
  it("does not write corrupt uploads or report a failed database update as successful", async () => {
    expect((await handleImageRequest(new Request("https://app.test/upload", { method: "PUT", headers: { "Content-Type": "image/png" }, body: "broken" }))).status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
    mocks.replace.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await handleImageRequest(request())).status).toBe(503);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
