import { describe, expect, it } from "vitest";
import { poolFilterSql } from "./draft";

// The division pools filter on both league and division. Division names differ
// by source (mlb-sync stores "National League Central", the seed stores
// "Central"), so the filter matches the division as a substring.
describe("poolFilterSql", () => {
  it("adds no filter for the all-MLB pool", () => {
    expect(poolFilterSql("all")).toBe("");
  });

  it("filters by league for AL/NL pools", () => {
    expect(poolFilterSql("al")).toBe("and mt.league ilike 'American%'");
    expect(poolFilterSql("nl")).toBe("and mt.league ilike 'National%'");
  });

  it("filters by league and division substring for division pools", () => {
    expect(poolFilterSql("nl-central")).toBe("and mt.league ilike 'National%' and mt.division ilike '%Central%'");
    expect(poolFilterSql("al-west")).toBe("and mt.league ilike 'American%' and mt.division ilike '%West%'");
  });

  it("respects a custom table alias", () => {
    expect(poolFilterSql("nl-east", "team")).toBe("and team.league ilike 'National%' and team.division ilike '%East%'");
  });
});
