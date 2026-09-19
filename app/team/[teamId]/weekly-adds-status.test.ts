// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WeeklyAddsStatus } from "./weekly-adds-status";
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows usage and the matchup reset in the viewer timezone", () => {
  render(React.createElement(WeeklyAddsStatus, { usage: { used: 4, limit: 6, resetsAt: "2026-09-21T07:00:00.000Z" }, timeZone: "America/Los_Angeles" }));
  expect(screen.getByText("Adds this week: 4/6")).toBeTruthy();
  expect(screen.getByText(/2 player adds remaining/)).toBeTruthy();
  expect(screen.getByText(/Resets Sep 21, 12:00 AM PDT/)).toBeTruthy();
});
it.each([6, 7])("explains a reached or lowered limit before an acquisition (%i used)", (used) => {
  render(React.createElement(WeeklyAddsStatus, { usage: { used, limit: 6, resetsAt: null }, timeZone: "UTC" }));
  expect(screen.getByText(/cannot add free agents or submit new waiver claims/)).toBeTruthy();
});
it("does not show a limit for Roto or an inactive matchup", () => {
  const { container } = render(React.createElement(WeeklyAddsStatus, { usage: null, timeZone: "UTC" }));
  expect(container.innerHTML).toBe("");
});
