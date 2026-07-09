import { describe, expect, it } from "vitest";
import { positionGroup, positionGroupClass } from "./position-color";

describe("positionGroup", () => {
  it("groups pitchers together", () => {
    expect(positionGroup("SP")).toBe("pitcher");
    expect(positionGroup("RP")).toBe("pitcher");
    expect(positionGroup("P")).toBe("pitcher");
  });

  it("maps infield and outfield families", () => {
    expect(positionGroup("1B")).toBe("corner-infield");
    expect(positionGroup("3B")).toBe("corner-infield");
    expect(positionGroup("2B")).toBe("middle-infield");
    expect(positionGroup("SS")).toBe("middle-infield");
    expect(positionGroup("OF")).toBe("outfield");
    expect(positionGroup("C")).toBe("catcher");
  });

  it("falls back to utility for unknown or flex positions", () => {
    expect(positionGroup("UTIL")).toBe("utility");
    expect(positionGroup("DH")).toBe("utility");
    expect(positionGroup("")).toBe("utility");
  });

  it("builds a CSS class from the group", () => {
    expect(positionGroupClass("OF")).toBe("pos-group-outfield");
    expect(positionGroupClass("SP")).toBe("pos-group-pitcher");
  });
});
