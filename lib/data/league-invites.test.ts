import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

// Drive the invite flows against a fake pool client so the security-relevant
// rules (commissioner-only create, hashed token at rest, single-use accept
// bound to the invited email) are pinned without a real database.

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let currentClient: FakeClient;

const { pooledQuery } = vi.hoisted(() => ({ pooledQuery: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
  isUniqueViolation: (error: unknown) => Boolean(error && (error as { code?: string }).code === "23505"),
  query: pooledQuery,
  getPool: () => ({ connect: async () => currentClient }),
}));

import { acceptLeagueInvite, createLeagueInvite, isInviteTokenRedeemable, LeagueInviteError } from "./league-invites";

const LEAGUE_ID = "00000000-0000-4000-8000-000000000001";
const inviter = { userId: "00000000-0000-4000-8000-000000000002", email: "commish@example.com" };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlCalls() {
  return currentClient.query.mock.calls.map((call) => call[0] as string);
}

function makeCreateClient({ isCommissioner = true, alreadyMember = false } = {}): FakeClient {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("from league l")) {
      return { rows: [{ league_name: "Test League", is_commissioner: isCommissioner }] };
    }
    if (sql.includes("union")) {
      return { rows: alreadyMember ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("select id, display_name from app_user")) {
      return { rows: [{ id: inviter.userId, display_name: "The Commish" }] };
    }
    if (sql.includes("insert into league_invite")) {
      return {
        rows: [
          {
            id: "invite-1",
            league_id: LEAGUE_ID,
            email: values?.[1],
            expires_at: new Date("2026-07-15T00:00:00Z"),
            created_at: new Date("2026-07-08T00:00:00Z"),
          },
        ],
      };
    }
    return { rows: [] };
  });

  return { query, release: vi.fn() };
}

beforeEach(() => {
  pooledQuery.mockReset();
  currentClient = makeCreateClient();
});

describe("createLeagueInvite", () => {
  it("refuses non-commissioners with 403 and writes nothing", async () => {
    currentClient = makeCreateClient({ isCommissioner: false });

    await expect(createLeagueInvite(LEAGUE_ID, "new@example.com", inviter)).rejects.toMatchObject({ status: 403 });
    expect(sqlCalls().some((sql) => sql.includes("insert into league_invite"))).toBe(false);
    expect(sqlCalls()).toContain("rollback");
  });

  it("refuses inviting an existing member with 409", async () => {
    currentClient = makeCreateClient({ alreadyMember: true });

    await expect(createLeagueInvite(LEAGUE_ID, "member@example.com", inviter)).rejects.toMatchObject({ status: 409 });
  });

  it("stores only the token hash and returns the raw token once", async () => {
    const created = await createLeagueInvite(LEAGUE_ID, "new@example.com", inviter);

    expect(created.token).toMatch(/^ofb_join_/);
    expect(created.summary).toMatchObject({ leagueName: "Test League", invitedByName: "The Commish" });

    const insertCall = currentClient.query.mock.calls.find(([sql]) => (sql as string).includes("insert into league_invite"));
    const insertParams = insertCall?.[1] as unknown[];
    // The stored value is the SHA-256 of the raw token; the raw token itself
    // never appears in any SQL parameter.
    expect(insertParams).toContain(sha256(created.token));
    const allParams = currentClient.query.mock.calls.flatMap(([, values]) => (values as unknown[]) ?? []);
    expect(allParams).not.toContain(created.token);
    expect(sqlCalls()).toContain("commit");
  });

  it("404s a non-UUID league id without touching the database", async () => {
    await expect(createLeagueInvite("nope", "new@example.com", inviter)).rejects.toMatchObject({ status: 404 });
  });
});

type AcceptRow = {
  id: string;
  league_id: string;
  league_name: string;
  email: string;
  expires_at: Date;
  accepted_at: Date | null;
};

function makeAcceptClient(invite: Partial<AcceptRow> | null, { hasTeam = false } = {}): FakeClient {
  const row: AcceptRow | null = invite
    ? {
        id: "invite-1",
        league_id: LEAGUE_ID,
        league_name: "Test League",
        email: "invitee@example.com",
        expires_at: new Date(Date.now() + 86_400_000),
        accepted_at: null,
        ...invite,
      }
    : null;

  const query = vi.fn(async (sql: string) => {
    if (sql.includes("for update of i")) {
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("insert into app_user")) {
      return { rows: [{ id: "00000000-0000-4000-8000-000000000009" }] };
    }
    if (sql.includes("select id from fantasy_team")) {
      return { rows: hasTeam ? [{ id: "team-1" }] : [] };
    }
    return { rows: [] };
  });

  return { query, release: vi.fn() };
}

const invitee = { email: "invitee@example.com", displayName: "New Manager" };

describe("acceptLeagueInvite", () => {
  it("rejects an unknown token with 404", async () => {
    currentClient = makeAcceptClient(null);
    await expect(acceptLeagueInvite("ofb_join_unknown", invitee)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a reused invite with 409", async () => {
    currentClient = makeAcceptClient({ accepted_at: new Date() });
    await expect(acceptLeagueInvite("ofb_join_x", invitee)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects an expired invite with 410", async () => {
    currentClient = makeAcceptClient({ expires_at: new Date(Date.now() - 1000) });
    await expect(acceptLeagueInvite("ofb_join_x", invitee)).rejects.toMatchObject({ status: 410 });
  });

  it("rejects a signed-in user whose email does not match the invite", async () => {
    currentClient = makeAcceptClient({});

    await expect(
      acceptLeagueInvite("ofb_join_x", { email: "other@example.com", displayName: "Other" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(sqlCalls().some((sql) => sql.includes("insert into league_member"))).toBe(false);
  });

  it("accepts case-insensitively, joins the league, creates a team, and marks the invite used", async () => {
    currentClient = makeAcceptClient({ email: "Invitee@Example.com" });

    const result = await acceptLeagueInvite("ofb_join_x", invitee);

    expect(result).toEqual({ leagueId: LEAGUE_ID, leagueName: "Test League" });
    const calls = sqlCalls();
    expect(calls.some((sql) => sql.includes("insert into league_member"))).toBe(true);
    expect(calls.some((sql) => sql.includes("insert into fantasy_team"))).toBe(true);
    expect(calls.some((sql) => sql.includes("set accepted_at = now()"))).toBe(true);
    expect(calls).toContain("commit");
  });

  it("does not create a second team for a user who already has one", async () => {
    currentClient = makeAcceptClient({}, { hasTeam: true });

    await acceptLeagueInvite("ofb_join_x", invitee);

    expect(sqlCalls().some((sql) => sql.includes("insert into fantasy_team"))).toBe(false);
  });
});

describe("isInviteTokenRedeemable (signup gate carve-out)", () => {
  function pendingInviteRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "invite-1",
      league_id: LEAGUE_ID,
      league_name: "Test League",
      email: "invitee@example.com",
      invited_by_name: "The Commish",
      expires_at: new Date(Date.now() + 86_400_000),
      accepted_at: null,
      ...overrides,
    };
  }

  it("is true for a live invite matching the email", async () => {
    pooledQuery.mockResolvedValueOnce({ rows: [pendingInviteRow()] });
    expect(await isInviteTokenRedeemable("ofb_join_x", "Invitee@example.com")).toBe(true);
  });

  it("is false for the wrong email, expired, used, or unknown tokens", async () => {
    pooledQuery.mockResolvedValueOnce({ rows: [pendingInviteRow()] });
    expect(await isInviteTokenRedeemable("ofb_join_x", "other@example.com")).toBe(false);

    pooledQuery.mockResolvedValueOnce({ rows: [pendingInviteRow({ expires_at: new Date(Date.now() - 1000) })] });
    expect(await isInviteTokenRedeemable("ofb_join_x", "invitee@example.com")).toBe(false);

    pooledQuery.mockResolvedValueOnce({ rows: [pendingInviteRow({ accepted_at: new Date() })] });
    expect(await isInviteTokenRedeemable("ofb_join_x", "invitee@example.com")).toBe(false);

    pooledQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isInviteTokenRedeemable("ofb_join_x", "invitee@example.com")).toBe(false);
  });
});

describe("LeagueInviteError", () => {
  it("defaults to a 400 status", () => {
    expect(new LeagueInviteError("bad").status).toBe(400);
  });
});
