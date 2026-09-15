import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PATCH } from "./route";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner } from "@/lib/auth/team-access";
import { updateLeagueSettings } from "@/lib/data/leagues";
import { recordAuditEvent } from "@/lib/data/audit";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";
vi.mock("@/lib/auth/api-identity", () => ({ resolveApiIdentity: vi.fn() }));
vi.mock("@/lib/auth/team-access", () => ({ isLeagueCommissioner: vi.fn(), requireLeagueViewer: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, isUuid: () => true }));
vi.mock("@/lib/data/leagues", () => ({ updateLeagueSettings: vi.fn(), getLeagueSettings: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
const identity = { userId: "commissioner", email: "commissioner@example.com" };
const context = { params: Promise.resolve({ leagueId: "league" }) };
function request(value: unknown) {
  return new Request("http://localhost/api/v1/leagues/league/settings", { method: "PATCH", body: JSON.stringify({ botsEligibleForPlayoffs: value }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolveApiIdentity).mockResolvedValue({ identity, response: null });
  vi.mocked(isLeagueCommissioner).mockResolvedValue(true);
  vi.mocked(updateLeagueSettings).mockResolvedValue(defaultLeagueSettings);
});
it.each([true, false])("saves and audits bot eligibility %s", async (value) => {
  expect((await PATCH(request(value), context)).status).toBe(200);
  expect(resolveApiIdentity).toHaveBeenCalledWith(expect.any(Request), "commissioner:league");
  expect(updateLeagueSettings).toHaveBeenCalledWith("league", { botsEligibleForPlayoffs: value });
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actor: identity, leagueId: "league", detail: { changes: { botsEligibleForPlayoffs: value } } }));
});
it.each([401, 403, 429])("preserves identity and rate-limit rejection %i", async (status) => {
  vi.mocked(resolveApiIdentity).mockResolvedValue({ identity: null, response: NextResponse.json({}, { status }) });
  expect((await PATCH(request(false), context)).status).toBe(status);
  expect(updateLeagueSettings).not.toHaveBeenCalled();
});
it("rejects non-commissioners", async () => {
  vi.mocked(isLeagueCommissioner).mockResolvedValue(false);
  expect((await PATCH(request(false), context)).status).toBe(403);
  expect(updateLeagueSettings).not.toHaveBeenCalled();
});
it.each(["false", 0, null])("rejects non-boolean eligibility %s", async (value) => {
  expect((await PATCH(request(value), context)).status).toBe(400);
  expect(updateLeagueSettings).not.toHaveBeenCalled();
});
