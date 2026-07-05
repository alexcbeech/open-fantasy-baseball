import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as playersGet } from "./players/route";
import { GET as lineupGet, PATCH as lineupPatch } from "./teams/[teamId]/lineup/route";
import { POST as actionsPost } from "./teams/[teamId]/players/[playerId]/actions/route";

// These lock the owner-API contract in demo mode (no database): shapes, status
// codes, and the guards that protect writes. Pin DATABASE_URL off so the run is
// deterministic regardless of the developer's shell env.
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const base = "https://ofb.test/api/v1";

function teamContext(teamId: string) {
  return { params: Promise.resolve({ teamId }) };
}

function playerContext(teamId: string, playerId: string) {
  return { params: Promise.resolve({ teamId, playerId }) };
}

describe("GET /players (read:league, public read)", () => {
  it("serves the player list without a token", async () => {
    const response = await playersGet(new Request(`${base}/players`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.players)).toBe(true);
    expect(body.players.length).toBeGreaterThan(0);
    expect(body.statWindows).toContain("season");
  });

  it("rejects a presented but unverifiable token with 401", async () => {
    const response = await playersGet(new Request(`${base}/players`, { headers: { authorization: "Bearer ofb_bogus" } }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatch(/invalid, expired, or revoked/);
  });

  it("rejects a malformed authorization header with 401", async () => {
    const response = await playersGet(new Request(`${base}/players`, { headers: { authorization: "Basic abc123" } }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Bearer token is required.");
  });
});

describe("GET /teams/{teamId}/lineup (read:team)", () => {
  it("returns a lineup and validation for a known team", async () => {
    const response = await lineupGet(new Request(`${base}/teams/team-1/lineup`), teamContext("team-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.lineup)).toBe(true);
    expect(body.validation).toHaveProperty("valid");
  });

  it("404s an unknown team", async () => {
    const response = await lineupGet(new Request(`${base}/teams/does-not-exist/lineup`), teamContext("does-not-exist"));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Team not found");
  });
});

describe("PATCH /teams/{teamId}/lineup (write:lineup)", () => {
  it("400s an empty lineup body", async () => {
    const response = await lineupPatch(
      new Request(`${base}/teams/team-1/lineup`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      teamContext("team-1"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Lineup entries are required");
  });

  it("400s entries that reference a player not on the roster", async () => {
    const response = await lineupPatch(
      new Request(`${base}/teams/team-1/lineup`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: [{ playerId: "ghost", slot: "C" }] }),
      }),
      teamContext("team-1"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid player or slot");
  });
});

describe("POST /teams/{teamId}/players/{playerId}/actions (write:transactions)", () => {
  it("400s an unknown action", async () => {
    const response = await actionsPost(
      new Request(`${base}/teams/team-1/players/player-1/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "explode" }),
      }),
      playerContext("team-1", "player-1"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/valid player action/i);
  });

  it("503s a valid action when no database is configured (writes need Postgres)", async () => {
    const response = await actionsPost(
      new Request(`${base}/teams/team-1/players/player-1/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add" }),
      }),
      playerContext("team-1", "player-1"),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/configured database/i);
  });
});
