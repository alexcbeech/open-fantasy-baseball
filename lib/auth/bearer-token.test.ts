import { beforeEach, describe, expect, it, vi } from "vitest";

// authorizeApiRequest verifies tokens against the database. Mock the db client
// so the scope-enforcement contract can be exercised without a real database:
// tryDatabase runs the query op, and `query` is driven per test.
// vi.hoisted so the mock fn exists when the hoisted vi.mock factory runs.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  tryDatabase: async (op: () => unknown) => op(),
  query,
}));

import { authorizeApiRequest, parseBearerToken } from "./bearer-token";

function request(authorization?: string) {
  return new Request("https://ofb.test/api/v1/resource", authorization ? { headers: { authorization } } : undefined);
}

function tokenRow(scopes: string[]) {
  return { rows: [{ token_id: "tok_1", user_id: "usr_1", email: "owner@ofb.test", scopes }] };
}

beforeEach(() => {
  query.mockReset();
});

describe("parseBearerToken", () => {
  it("returns the token for a valid bearer header", () => {
    expect(parseBearerToken("Bearer ofb_abc123")).toBe("ofb_abc123");
  });

  it("accepts a lowercase bearer scheme", () => {
    expect(parseBearerToken("bearer ofb_abc123")).toBe("ofb_abc123");
  });

  it("rejects missing, malformed, or non-bearer headers", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken("Basic abc123")).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer one two")).toBeNull();
  });
});

describe("authorizeApiRequest", () => {
  it("allows a missing bearer when the route opts in (public read)", async () => {
    const result = await authorizeApiRequest(request(), "read:league", { allowMissingBearer: true });
    expect(result.response).toBeNull();
    expect(result.principal).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("401s a missing bearer when the route requires one", async () => {
    const result = await authorizeApiRequest(request(), "read:team");
    expect(result.principal).toBeNull();
    expect(result.response?.status).toBe(401);
    expect(await result.response!.json()).toEqual({ error: "Bearer token is required." });
  });

  it("401s a malformed authorization header even when a bearer is optional", async () => {
    const result = await authorizeApiRequest(request("Basic abc123"), "read:team", { allowMissingBearer: true });
    expect(result.response?.status).toBe(401);
    expect(await result.response!.json()).toEqual({ error: "Bearer token is required." });
  });

  it("401s an unknown, expired, or revoked token", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await authorizeApiRequest(request("Bearer ofb_missing"), "read:team");
    expect(result.response?.status).toBe(401);
    expect(await result.response!.json()).toEqual({ error: "Bearer token is invalid, expired, or revoked." });
  });

  it("403s a valid token that lacks the required scope", async () => {
    query.mockResolvedValueOnce(tokenRow(["read:team"]));
    const result = await authorizeApiRequest(request("Bearer ofb_readonly"), "write:lineup");
    expect(result.response?.status).toBe(403);
    expect(await result.response!.json()).toEqual({ error: "Bearer token requires write:lineup." });
    // The principal is still returned alongside the 403 so callers can log it.
    expect(result.principal?.scopes).toEqual(["read:team"]);
  });

  it("passes a valid token that holds the required scope", async () => {
    query.mockResolvedValueOnce(tokenRow(["read:team", "write:lineup"]));
    const result = await authorizeApiRequest(request("Bearer ofb_writer"), "write:lineup");
    expect(result.response).toBeNull();
    expect(result.principal).toMatchObject({ tokenId: "tok_1", userId: "usr_1", email: "owner@ofb.test" });
  });

  it("looks the token up by its SHA-256 hash, never the raw secret", async () => {
    query.mockResolvedValueOnce(tokenRow(["read:team"]));
    await authorizeApiRequest(request("Bearer ofb_super_secret"), "read:team");
    const values = query.mock.calls[0]![1] as string[];
    expect(values[0]).not.toContain("ofb_super_secret");
    expect(values[0]).toMatch(/^[a-f0-9]{64}$/);
  });
});
