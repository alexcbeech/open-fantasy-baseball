import { describe, expect, it } from "vitest";
import { parseBearerToken } from "./bearer-token";

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
