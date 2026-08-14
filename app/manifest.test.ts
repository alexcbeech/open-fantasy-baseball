import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("PWA manifest", () => {
  it("describes an installable standalone application", () => {
    const value = manifest();

    expect(value).toMatchObject({
      id: "/",
      name: "Open Fantasy Baseball",
      short_name: "OFB",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#eaeef4",
      theme_color: "#14213d",
    });
    expect(value.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "any" }),
        expect.objectContaining({ sizes: "192x192", type: "image/png", purpose: "maskable" }),
        expect.objectContaining({ sizes: "512x512", type: "image/png", purpose: "maskable" }),
      ]),
    );
  });
});
