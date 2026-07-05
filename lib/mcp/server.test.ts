import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ApiPrincipal } from "@/lib/auth/bearer-token";

// Mock only token verification (the database call) so the JSON-RPC and scope
// contract can be exercised without a database; parseBearerToken stays real and
// the tool data-layer calls run in mock mode.
const { verifyBearerToken } = vi.hoisted(() => ({ verifyBearerToken: vi.fn() }));
vi.mock("@/lib/auth/bearer-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/bearer-token")>();
  return { ...actual, verifyBearerToken };
});

import { handleMcpRequest, mcpTools } from "./server";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "");
});
afterEach(() => {
  verifyBearerToken.mockReset();
});

const rpc = (method: string, params?: unknown, id: string | number | null = 1) => ({ jsonrpc: "2.0", id, method, params });

function principal(scopes: ApiPrincipal["scopes"]): ApiPrincipal {
  return { tokenId: "tok_1", userId: "usr_1", email: "owner@ofb.test", scopes };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = any;

describe("MCP JSON-RPC protocol", () => {
  it("rejects a non-2.0 payload with -32600", async () => {
    const res = (await handleMcpRequest({ id: 1, method: "initialize" }, null)) as Rpc;
    expect(res.error.code).toBe(-32600);
  });

  it("initialize advertises the protocol, tool capability, and server info", async () => {
    const res = (await handleMcpRequest(rpc("initialize"), null)) as Rpc;
    expect(res.result.protocolVersion).toBeTruthy();
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.serverInfo.name).toBe("open-fantasy-baseball");
  });

  it("swallows notifications/initialized (returns nothing)", async () => {
    expect(await handleMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, null)).toBeNull();
  });

  it("tools/list returns every tool with its required scope", async () => {
    const res = (await handleMcpRequest(rpc("tools/list"), null)) as Rpc;
    const names = res.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(mcpTools.map((t) => t.name));
    for (const tool of res.result.tools) {
      expect(tool.metadata.requiredScope).toBeTruthy();
    }
  });

  it("rejects an unknown method with -32601", async () => {
    const res = (await handleMcpRequest(rpc("resources/list"), null)) as Rpc;
    expect(res.error.code).toBe(-32601);
  });
});

describe("MCP tools/call auth + scope", () => {
  it("rejects a missing bearer with -32001 before verifying", async () => {
    const res = (await handleMcpRequest(rpc("tools/call", { name: "ofb_get_profile" }), null)) as Rpc;
    expect(res.error.code).toBe(-32001);
    expect(res.error.message).toMatch(/token is required/i);
    expect(verifyBearerToken).not.toHaveBeenCalled();
  });

  it("rejects an unverifiable token with -32001", async () => {
    verifyBearerToken.mockResolvedValue(null);
    const res = (await handleMcpRequest(rpc("tools/call", { name: "ofb_get_profile" }), "Bearer ofb_bogus")) as Rpc;
    expect(res.error.code).toBe(-32001);
    expect(res.error.message).toMatch(/invalid, expired, or revoked/i);
  });

  it("rejects a token lacking the tool's scope with -32003", async () => {
    verifyBearerToken.mockResolvedValue(principal(["read:team"]));
    const res = (await handleMcpRequest(rpc("tools/call", { name: "ofb_get_profile" }), "Bearer ofb_token")) as Rpc;
    expect(res.error.code).toBe(-32003);
    expect(res.error.message).toMatch(/read:profile/);
  });

  it("rejects an unknown tool with -32602", async () => {
    const res = (await handleMcpRequest(rpc("tools/call", { name: "ofb_launch_rockets" }), "Bearer ofb_token")) as Rpc;
    expect(res.error.code).toBe(-32602);
  });
});

describe("MCP tool execution (authorized, mock data)", () => {
  it("ofb_search_players returns players and respects the limit", async () => {
    verifyBearerToken.mockResolvedValue(principal(["read:league"]));
    const res = (await handleMcpRequest(
      rpc("tools/call", { name: "ofb_search_players", arguments: { limit: 2 } }),
      "Bearer ofb_token",
    )) as Rpc;
    expect(res.result.isError).toBe(false);
    expect(res.result.structuredContent.players.length).toBeLessThanOrEqual(2);
    expect(res.result.structuredContent.totalMatches).toBeGreaterThan(0);
    // Structured content is mirrored as text for non-structured clients.
    expect(res.result.content[0].type).toBe("text");
  });

  it("ofb_get_team_roster returns a known team's roster and validation", async () => {
    verifyBearerToken.mockResolvedValue(principal(["read:team"]));
    const res = (await handleMcpRequest(
      rpc("tools/call", { name: "ofb_get_team_roster", arguments: { teamId: "team-1" } }),
      "Bearer ofb_token",
    )) as Rpc;
    expect(res.result.isError).toBe(false);
    expect(res.result.structuredContent.team).toBeDefined();
    expect(res.result.structuredContent.validation).toHaveProperty("valid");
  });

  it("ofb_get_team_roster reports an unknown team as a tool error", async () => {
    verifyBearerToken.mockResolvedValue(principal(["read:team"]));
    const res = (await handleMcpRequest(
      rpc("tools/call", { name: "ofb_get_team_roster", arguments: { teamId: "no-such-team" } }),
      "Bearer ofb_token",
    )) as Rpc;
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/Team not found/);
  });

  it("validates tool arguments (missing teamId) with -32602", async () => {
    verifyBearerToken.mockResolvedValue(principal(["read:team"]));
    const res = (await handleMcpRequest(
      rpc("tools/call", { name: "ofb_get_team_roster", arguments: {} }),
      "Bearer ofb_token",
    )) as Rpc;
    expect(res.error.code).toBe(-32602);
  });
});
