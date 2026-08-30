import { describe, expect, it } from "vitest";

import { isPublicAssetPath, isPublicPagePath } from "./public-paths";

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

describe("isPublicAssetPath", () => {
  it.each([
    "/favicon.ico",
    "/icon.svg",
    "/brand/ofb-tile.svg",
    "/icons/icon-192.png",
    "/icons/icon-maskable-v2-512.png",
    "/manifest.webmanifest",
    "/offline.html",
    "/offline.css",
    "/sw.js",
    "/_next/static/chunks/app.js",
    "/_next/image",
  ])("keeps public PWA asset %s outside authentication", (path) => {
    expect(isPublicAssetPath(path)).toBe(true);
  });

  it.each(["/", "/profile", "/team/team-1", "/api/v1/health"])("does not expose app route %s", (path) => {
    expect(isPublicAssetPath(path)).toBe(false);
  });
});
