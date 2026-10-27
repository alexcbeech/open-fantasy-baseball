import { describe, expect, it } from "vitest";
import { isCrossOriginMutation } from "./request-origin";

describe("API mutation origin validation", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks foreign and opaque origins for %s", method => {
    for (const origin of ["https://evil.test", "https://sibling.ofb.test", "null"]) {
      expect(isCrossOriginMutation(new Request("https://ofb.test/api/v1/leagues", { method, headers: { origin } }))).toBe(true);
    }
  });
  it("allows same-origin writes and non-browser API clients", () => {
    expect(isCrossOriginMutation(new Request("https://ofb.test/api/v1/leagues", { method: "POST", headers: { origin: "https://ofb.test" } }))).toBe(false);
    expect(isCrossOriginMutation(new Request("https://ofb.test/api/v1/leagues", { method: "POST", headers: { authorization: "Bearer token" } }))).toBe(false);
  });
  it("rejects cross-site writes with a stripped origin", () => {
    expect(isCrossOriginMutation(new Request("https://ofb.test/api/v1/leagues", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))).toBe(true);
  });
  it.each(["GET", "HEAD", "OPTIONS"])("preserves safe requests and OAuth redirects: %s", method => {
    expect(isCrossOriginMutation(new Request("https://ofb.test/api/auth/callback/google", { method, headers: { origin: "https://accounts.google.com", "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
});
