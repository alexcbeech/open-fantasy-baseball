// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeagueSettingsEditor } from "./league-settings-editor";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("saves disabled eligibility and displays an error if re-enabling fails", async () => {
  render(React.createElement(LeagueSettingsEditor, { leagueId: "league", settings: defaultLeagueSettings }));
  fireEvent.click(screen.getByRole("button", { name: "Edit League Settings" }));
  const toggle = screen.getByRole("checkbox", { name: "Allow bots to make the playoffs" }) as HTMLInputElement;
  expect(toggle.checked).toBe(true);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(screen.getByText("Settings saved.")).toBeTruthy());
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toBe("/api/v1/leagues/league/settings");
  expect(JSON.parse(options!.body as string).botsEligibleForPlayoffs).toBe(false);
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Try again later." }) } as Response);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(screen.getByText("Try again later.")).toBeTruthy());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).botsEligibleForPlayoffs).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("hides the playoff setting in roto leagues", () => {
  render(React.createElement(LeagueSettingsEditor, { leagueId: "league", settings: { ...defaultLeagueSettings, scoringType: "roto" } }));
  fireEvent.click(screen.getByRole("button", { name: "Edit League Settings" }));
  expect(screen.queryByRole("checkbox", { name: "Allow bots to make the playoffs" })).toBeNull();
  expect(screen.queryByRole("spinbutton", { name: "Weekly player adds" })).toBeNull();
});

it("defaults legacy leagues to six adds, validates input, and saves commissioner changes", async () => {
  render(React.createElement(LeagueSettingsEditor, { leagueId: "league", settings: { ...defaultLeagueSettings, weeklyPlayerAddLimit: undefined } }));
  fireEvent.click(screen.getByRole("button", { name: "Edit League Settings" }));
  const input = screen.getByRole("spinbutton", { name: "Weekly player adds" }) as HTMLInputElement;
  expect(input.value).toBe("6");
  fireEvent.change(input, { target: { value: "1.5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText("Weekly player adds must be a whole number from 0 to 1000.")).toBeTruthy();
  fireEvent.change(input, { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
  await waitFor(() => expect(screen.getByText("Settings saved.")).toBeTruthy());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).weeklyPlayerAddLimit).toBe(8);
});
