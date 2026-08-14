import { describe, expect, it } from "vitest";
import { draftStatLine } from "./pick-sheet";

describe("draftStatLine", () => {
  it("orders hitter stats in a familiar compact line", () => {
    expect(draftStatLine({ RBI: 20, AVG: ".281", H: 30, AB: 100, HR: 7 })).toBe(
      "30 H · 100 AB · 7 HR · 20 RBI · .281 AVG",
    );
  });

  it("orders pitcher stats separately", () => {
    expect(draftStatLine({ ERA: "3.20", W: 4, K: 55, IP: "48.0", WHIP: "1.10" })).toBe(
      "48.0 IP · 55 K · 4 W · 3.20 ERA · 1.10 WHIP",
    );
  });
});
