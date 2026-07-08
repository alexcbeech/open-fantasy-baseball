import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { readRoute } from "./read-route";

describe("readRoute", () => {
  it("passes through the handler's response unchanged", async () => {
    const ok = NextResponse.json({ hello: "world" }, { status: 200 });
    const response = await readRoute(async () => ok);

    expect(response).toBe(ok);
    expect(response.status).toBe(200);
  });

  it("preserves non-200 responses the handler returns (401/403/404)", async () => {
    const forbidden = await readRoute(async () => NextResponse.json({ error: "nope" }, { status: 403 }));
    expect(forbidden.status).toBe(403);
  });

  it("converts a thrown error into a 503 instead of letting it 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await readRoute(async () => {
      throw new Error("connection terminated unexpectedly");
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "This data is temporarily unavailable. Please try again shortly.",
    });

    vi.restoreAllMocks();
  });
});
