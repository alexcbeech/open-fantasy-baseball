import { describe, expect, it } from "vitest";
import { isPlayerInPool, poolFilterConditionSql, poolFilterSql } from "./player-pool";

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

  it("supports dynamic WHERE clauses without a leading conjunction", () => {
    expect(poolFilterConditionSql("nl-central")).toBe(
      "mt.league ilike 'National%' and mt.division ilike '%Central%'",
    );
  });

  it("uses the same pool rules for acquisition guards", () => {
    expect(isPlayerInPool("nl-central", { league: "National League", division: "National League Central" })).toBe(true);
    expect(isPlayerInPool("nl-central", { league: "National League", division: "National League East" })).toBe(false);
    expect(isPlayerInPool("nl-central", { league: "American League", division: "American League Central" })).toBe(false);
    expect(isPlayerInPool("all", { league: null, division: null })).toBe(true);
    expect(isPlayerInPool("nl", { league: null, division: null })).toBe(false);
  });
});
