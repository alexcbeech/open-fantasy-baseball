import { describe, expect, it } from "vitest";
import { buildWaiverNotification } from "./notifications";

describe("buildWaiverNotification", () => {
  it("congratulates a won claim and links to the league", () => {
    const note = buildWaiverNotification("won", "Bryan Woo", "lg-1");
    expect(note).toEqual({
      type: "waiver_result",
      title: "Waiver claim won",
      body: "You won Bryan Woo off waivers.",
      url: "/league/lg-1",
    });
  });

  it("explains a lost claim", () => {
    const note = buildWaiverNotification("lost", "Bryan Woo", "lg-1");
    expect(note.type).toBe("waiver_result");
    expect(note.title).toBe("Waiver claim lost");
    expect(note.body).toMatch(/didn't go through/);
    expect(note.url).toBe("/league/lg-1");
  });
});
