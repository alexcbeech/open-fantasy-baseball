import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { GET } from "./route";
import { getTeamDailyPlayerStatus } from "@/lib/data/mlb-live";
import { requireTeamViewer } from "@/lib/auth/team-access";

vi.mock("@/lib/auth/api-identity", () => ({ resolveApiIdentity: vi.fn(async () => ({ identity: {} })) }));
vi.mock("@/lib/auth/team-access", () => ({ requireTeamViewer: vi.fn(async () => null) }));
vi.mock("@/lib/api/read-route", () => ({ readRoute: (read: () => unknown) => read() }));
vi.mock("@/lib/data/mlb-live", () => ({ getTeamDailyPlayerStatus: vi.fn(async () => ({ live: { player: { state: "Top 9" } }, today: { player: { points: 12 } }, lineups: {} })) }));

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
const context = { params: Promise.resolve({ teamId: "team-1" }) };

describe("selected-day live stats", () => {
  it("keeps the Pacific day's stats and live status after Eastern midnight", async () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-09-12T04:30:00Z"));
    const response = await GET(new Request("http://localhost/api/v1/teams/team-1/live?date=2026-09-11"), context);
    expect(getTeamDailyPlayerStatus).toHaveBeenCalledWith("team-1", undefined, new Date("2026-09-11T16:00:00Z"));
    expect(await response.json()).toMatchObject({ live: { player: { state: "Top 9" } }, today: { player: { points: 12 } } });
  });
  it("rejects invalid dates", async () => {
    expect((await GET(new Request("http://localhost/api/v1/teams/team-1/live?date=2026-02-30"), context)).status).toBe(400);
    expect(getTeamDailyPlayerStatus).not.toHaveBeenCalled();
  });
  it("retains team authorization", async () => {
    vi.mocked(requireTeamViewer).mockResolvedValueOnce(new NextResponse("Forbidden", { status: 403 }));
    expect((await GET(new Request("http://localhost/api/v1/teams/team-1/live?date=2026-09-11"), context)).status).toBe(403);
    expect(getTeamDailyPlayerStatus).not.toHaveBeenCalled();
  });
});
