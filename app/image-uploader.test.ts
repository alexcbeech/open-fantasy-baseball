// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImageUploader } from "./image-uploader";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => {
  // The app's JSX is normally transformed by Next; provide the classic runtime in this unit harness.
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: "https://example.test/small.webp" }) }));
  URL.createObjectURL = vi.fn(() => "blob:preview"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup() {
  render(React.createElement(ImageUploader, { endpoint: "/api/v1/profile/image", initialUrl: "https://example.test/old.webp", name: "Alex", label: "Profile picture", enabled: true }));
  fireEvent.click(screen.getByText("Edit profile picture"));
  return screen.getByLabelText("Choose profile picture");
}
it("rejects oversized or unsupported files before any network request", () => {
  const input = setup();
  for (const file of [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" }), new File(["svg"], "logo.svg", { type: "image/svg+xml" })]) {
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("alert").textContent).toContain("up to 4 MB");
    expect((screen.getByRole("button", { name: "Upload image" }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("previews then uploads the selected file and supports removal", async () => {
  const input = setup();
  const file = new File(["png"], "logo.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  expect(document.querySelector("img")?.getAttribute("src")).toBe("blob:preview");
  fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Profile picture saved."));
  expect(fetch).toHaveBeenCalledWith("/api/v1/profile/image", { method: "PUT", headers: { "Content-Type": "image/png" }, body: file });
  expect(document.querySelector("img")?.getAttribute("src")).toBe("https://example.test/small.webp");
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ url: null }) } as Response);
  fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Profile picture removed."));
  expect(document.querySelector("img")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});
it("keeps the original image when the server rejects an upload", async () => {
  const input = setup();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Image could not be read." }) } as Response);
  fireEvent.change(input, { target: { files: [new File(["bad"], "bad.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be read"));
  expect(refresh).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Remove image" }) as HTMLButtonElement).disabled).toBe(false);
});
