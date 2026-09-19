// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BotManagers } from "./bot-managers";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires a connection and model before enabling; saves, hides and revokes tokens", async () => {
  let manager = { teamId: "bot", name: "Bot: Bleacher Creatures", model: "", strategy: "", enabled: false, allowTrades: false, hasToken: false, tokenExpiresAt: null };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (body.action === "rotate-token") { manager = { ...manager, hasToken: true, enabled: false }; return Response.json({ token: "test-only-secret" }); }
      if (body.action === "revoke-token") manager = { ...manager, hasToken: false, enabled: false };
      else manager = { ...manager, ...body };
      return Response.json({ accepted: true, token: null });
    }
    return Response.json({ managers: [manager], decisions: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  render(createElement(BotManagers, { leagueId: "league", canManage: true }));
  fireEvent.click(screen.getByRole("button", { name: "View AI managers" }));
  await screen.findByRole("heading", { name: "Bot: Bleacher Creatures" });
  expect((screen.getByLabelText("Enable AI management") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Create connection token" }));
  await screen.findByDisplayValue("test-only-secret");
  expect((screen.getByLabelText("Enable AI management") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Hide token" }));
  expect(screen.queryByDisplayValue("test-only-secret")).toBeNull();
  fireEvent.change(screen.getByLabelText("Model", { exact: true }), { target: { value: "chosen-model" } });
  fireEvent.change(screen.getByLabelText("Management strategy"), { target: { value: "Use IL first" } });
  fireEvent.click(screen.getByLabelText("Enable AI management"));
  fireEvent.click(screen.getByRole("button", { name: "Save AI manager" }));
  await screen.findByText("AI manager saved.");
  await screen.findByText("chosen-model · AI management enabled");
  expect(manager).toMatchObject({ enabled: true, strategy: "Use IL first", model: "chosen-model" });
  fireEvent.click(screen.getByRole("button", { name: "Revoke connection" }));
  await screen.findByText("Connection revoked. AI management is paused.");
  await waitFor(() => expect((screen.getByLabelText("Enable AI management") as HTMLInputElement).disabled).toBe(true));
});
it("shows a failed save without losing the edited strategy", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init?.method === "POST"
    ? Response.json({ error: "Commissioner access is required." }, { status: 403 })
    : Response.json({ managers: [{ teamId: "a", name: "Bot A", model: "", strategy: "", enabled: false, allowTrades: false, hasToken: false }], decisions: [] })));
  render(createElement(BotManagers, { leagueId: "league", canManage: true }));
  fireEvent.click(screen.getByRole("button", { name: "View AI managers" }));
  await screen.findByLabelText("Management strategy");
  fireEvent.change(screen.getByLabelText("Management strategy"), { target: { value: "Keep the ace" } });
  fireEvent.click(screen.getByRole("button", { name: "Save AI manager" }));
  await screen.findByText("Commissioner access is required.");
  expect((screen.getByLabelText("Management strategy") as HTMLTextAreaElement).value).toBe("Keep the ace");
});
