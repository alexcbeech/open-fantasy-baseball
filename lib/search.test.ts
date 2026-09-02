import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./search";

describe("normalizeSearchText", () => {
  it("makes accented player names searchable with unaccented text", () => {
    expect(normalizeSearchText("Héctor Rodríguez")).toContain(normalizeSearchText("Hector Rodriguez"));
  });

  it("matches composed and decomposed accents", () => {
    expect(normalizeSearchText("José Ramírez")).toBe(normalizeSearchText("Jose\u0301 Rami\u0301rez"));
  });

  it("remains case-insensitive", () => {
    expect(normalizeSearchText("ACUÑA JR.")).toBe(normalizeSearchText("acuña jr."));
  });
});
