import { describe, expect, it } from "vitest";
import { isValidTimeZone, profilePreferenceUpdateSchema } from "./profile";

describe("profile time zones", () => {
  it("accepts IANA zones including European zones and rejects invalid values", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Europe/Athens")).toBe(true);
    expect(isValidTimeZone("UTC+2")).toBe(false);
    expect(isValidTimeZone("not/a-zone")).toBe(false);
  });

  it("reports an invalid time zone in the profile schema", () => {
    const parsed = profilePreferenceUpdateSchema.safeParse({
      displayName: "Alex",
      timeZone: "not/a-zone",
      displayMode: "auto",
      notifications: { injuries: true, trades: true, waivers: true, lineupAlerts: false },
    });
    expect(parsed.success).toBe(false);
  });
});
