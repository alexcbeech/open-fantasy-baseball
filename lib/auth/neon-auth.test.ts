import { describe, expect, it } from "vitest";
import { hasAdminRole, normalizeAuthRoles } from "./roles";

describe("Neon auth role mapping", () => {
  it("normalizes string and array role values", () => {
    expect(normalizeAuthRoles({ role: ["admin", "manager"], roles: ["admin", "commissioner"] })).toEqual([
      "admin",
      "manager",
      "commissioner",
    ]);
  });

  it("treats admin role checks case-insensitively", () => {
    expect(hasAdminRole(["Admin"])).toBe(true);
    expect(hasAdminRole(["manager"])).toBe(false);
  });
});
