// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SignUpForm } from "./sign-up-form";

vi.mock("./actions", () => ({ signUpWithEmail: vi.fn() }));
beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("signup enrollment recovery link", () => {
  it("preserves the invite for password sign-in and enrollment recovery", () => {
    render(React.createElement<{ inviteToken?: string }>(SignUpForm, { inviteToken: "ofb_join_test-token" }));
    const link = screen.getByRole("link", { name: "Sign in" });
    const url = new URL(link.getAttribute("href")!, "https://ofb.test");
    expect(url.pathname).toBe("/auth/sign-in");
    expect(url.searchParams.get("next")).toBe("/join/ofb_join_test-token");
  });
  it("uses ordinary sign-in when there is no invite", () => {
    render(React.createElement(SignUpForm));
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth/sign-in");
  });
});
