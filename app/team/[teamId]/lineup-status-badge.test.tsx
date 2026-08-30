import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LineupStatusBadge } from "./lineup-status-badge";

describe("LineupStatusBadge", () => {
  it("renders a confirmed batting-order spot", () => {
    const markup = renderToStaticMarkup(<LineupStatusBadge status="starting" battingOrder={3} />);
    expect(markup).toContain("is-starting");
    expect(markup).toContain("Batting 3 in today&#x27;s posted lineup");
    expect(markup).toContain(">3<");
  });

  it("renders a red-X state for an omitted batter", () => {
    const markup = renderToStaticMarkup(<LineupStatusBadge status="not-starting" battingOrder={null} />);
    expect(markup).toContain("is-out");
    expect(markup).toContain("Not in today&#x27;s posted lineup");
    expect(markup).toContain("×");
  });
});
