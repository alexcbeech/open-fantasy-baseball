import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PATCH } from "./route";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamManager } from "@/lib/auth/team-access";
import { query, isDatabaseConfigured } from "@/lib/db/client";
import { recordAuditEvent } from "@/lib/data/audit";
import { resetRateLimiter } from "@/lib/rate-limit";

vi.mock("@/lib/auth/api-identity", () => ({ resolveApiIdentity: vi.fn() }));
vi.mock("@/lib/auth/team-access", () => ({ requireTeamManager: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ query: vi.fn(), isDatabaseConfigured: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
const identity = { userId: "manager", email: "manager@example.com" };
const context = { params: Promise.resolve({ teamId: "team-a" }) };
function request(body: unknown) {
  return new Request("http://localhost/api/v1/teams/team-a/auto-start-active", { method: "PATCH", body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks(); resetRateLimiter();
  vi.mocked(resolveApiIdentity).mockResolvedValue({ identity, response: null });
  vi.mocked(requireTeamManager).mockResolvedValue(null);
  vi.mocked(isDatabaseConfigured).mockReturnValue(true);
  vi.mocked(query).mockResolvedValue({ rows: [{ league_id: "league-a", auto_start_active: true }] } as never);
});
it.each([401, 403, 429])("propagates identity rejection %i without writing", async (status) => {
  vi.mocked(resolveApiIdentity).mockResolvedValue({ identity: null, response: NextResponse.json({}, { status }) });
  expect((await PATCH(request({ enabled: true }), context)).status).toBe(status);
  expect(query).not.toHaveBeenCalled();
});
it("denies another team's manager", async () => {
  vi.mocked(requireTeamManager).mockResolvedValue(NextResponse.json({}, { status: 403 }));
  expect((await PATCH(request({ enabled: true }), context)).status).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
it.each([true, false])("persists and audits enabled=%s for only the requested team", async (enabled) => {
  vi.mocked(query).mockResolvedValue({ rows: [{ league_id: "league-a", auto_start_active: enabled }] } as never);
  expect(await (await PATCH(request({ enabled }), context)).json()).toEqual({ enabled });
  expect(resolveApiIdentity).toHaveBeenCalledWith(expect.any(Request), "write:lineup");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("where id = $1"), ["team-a", enabled]);
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actor: identity, teamId: "team-a", detail: { enabled } }));
});
it.each([null, {}, { enabled: "true" }, { enabled: 1 }])("rejects invalid settings %j", async (body) => {
  expect((await PATCH(request(body), context)).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
it("does not pretend to persist in demo mode", async () => {
  vi.mocked(isDatabaseConfigured).mockReturnValue(false);
  expect((await PATCH(request({ enabled: true }), context)).status).toBe(503);
  expect(query).not.toHaveBeenCalled();
});
it("limits repeated changes per manager", async () => {
  for (let i = 0; i < 30; i++) await PATCH(request({ enabled: true }), context);
  expect((await PATCH(request({ enabled: false }), context)).status).toBe(429);
  expect(query).toHaveBeenCalledTimes(30);
});
it("rejects cross-origin mutations", async () => {
  const req = request({ enabled: true }); req.headers.set("origin", "https://other.example");
  expect((await PATCH(req, context)).status).toBe(403);
  expect(query).not.toHaveBeenCalled();
});
