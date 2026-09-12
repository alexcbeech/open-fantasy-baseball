import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { LineupDateNavigation } from "./lineup-date-navigation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("local lineup navigation", () => {
  it("links Today to the viewer's day while preserving the league lock", () => {
    const html = renderToStaticMarkup(createElement(LineupDateNavigation, { teamId: "team-1", date: "2026-09-11", today: "2026-09-11", editableFromDate: "2026-09-12" }));
    expect(html).toContain('href="/team/team-1?date=2026-09-11">Today');
    expect(html).toContain("Today&#x27;s lineup · locked");
  });
});
