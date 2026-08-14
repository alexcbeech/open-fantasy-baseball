import { describe, expect, it } from "vitest";

import { isPublicPagePath } from "./public-paths";

describe("isPublicPagePath", () => {
  it("allows invite landing pages before authentication", () => {
    expect(isPublicPagePath("/join")).toBe(true);
    expect(isPublicPagePath("/join/invite-token")).toBe(true);
  });

  it("preserves other public pages", () => {
    expect(isPublicPagePath("/api-docs")).toBe(true);
  });

  it("does not make similarly named or protected pages public", () => {
    expect(isPublicPagePath("/joiner")).toBe(false);
    expect(isPublicPagePath("/team/abc")).toBe(false);
  });
});
