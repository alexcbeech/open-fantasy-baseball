import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, sendEmail } from "./email";

const message = {
  to: "invitee@example.com",
  subject: "You're invited",
  html: "<p>hi</p>",
  text: "hi",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendEmail via Resend", () => {
  it("reports not-configured without calling the provider when env is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");

    expect(isEmailConfigured()).toBe(false);
    const result = await sendEmail(message);

    expect(result.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the message to Resend with the API key and from address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "OFB <invites@mail.example.com>");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
    );

    const result = await sendEmail(message);

    expect(result).toEqual({ ok: true, id: "email-1" });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      from: "OFB <invites@mail.example.com>",
      to: ["invitee@example.com"],
      subject: "You're invited",
    });
  });

  it("returns a structured failure instead of throwing on a provider error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "OFB <invites@mail.example.com>");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    const result = await sendEmail(message);

    expect(result).toEqual({ ok: false, reason: "Email provider returned 429." });
  });

  it("returns a structured failure when the provider is unreachable", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "OFB <invites@mail.example.com>");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));

    const result = await sendEmail(message);

    expect(result).toEqual({ ok: false, reason: "Email provider is unreachable." });
  });
});
