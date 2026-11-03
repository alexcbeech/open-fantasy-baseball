// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LeagueStandings } from "./league-standings";
import type { LeagueStanding } from "@/lib/fantasy/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./team-lineup-sheet", () => ({ TeamLineupSheet: () => null }));
vi.mock("./trade-proposal-sheet", () => ({ TradeProposalSheet: () => null }));

const standings: LeagueStanding[] = [
  { teamId: "winner", teamName: "Bubba Boys", managerName: "Manager", rank: 1, record: "5-1", points: 100, postseason: "Championship" },
  { teamId: "runner-up", teamName: "Sterling", managerName: "Manager", rank: 2, record: "4-2", points: 90, postseason: "Championship" },
];

afterEach(cleanup);

it("marks only the finalized champion in standings", () => {
  const view = render(React.createElement(LeagueStandings, {
    standings, championTeamId: "winner", leagueId: "league", viewerTeamId: "runner-up", canTrade: false,
  }));
  const championRow = screen.getByRole("row", { name: /Bubba Boys/ });
  expect(championRow.className).toContain("standings-champion-row");
  expect(within(championRow).getByText("🏆 League champion")).toBeTruthy();
  expect(within(screen.getByRole("row", { name: /Sterling/ })).queryByText(/League champion/)).toBeNull();

  view.rerender(React.createElement(LeagueStandings, {
    standings, leagueId: "league", viewerTeamId: "runner-up", canTrade: false,
  }));
  expect(screen.queryByText(/League champion/)).toBeNull();
});
