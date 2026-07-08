/**
 * Transactional email via the Resend HTTP API. Vercel has no outbound mail
 * service, so email is an API call like any other external service. Mirrors
 * the web-push posture: when RESEND_API_KEY is absent the feature degrades
 * gracefully (senders report "not configured" instead of throwing), which
 * keeps local dev and demo mode working without an account.
 */

const RESEND_API_URL = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendResult = { ok: true; id: string | null } | { ok: false; reason: string };

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

/**
 * Send one email. Returns a structured result instead of throwing so callers
 * can degrade (e.g. hand the commissioner a copyable invite link) when the
 * provider is down or unconfigured.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  if (!isEmailConfigured()) {
    return { ok: false, reason: "Email is not configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // The API key and recipient address stay out of the log; status + body
      // from Resend are enough to diagnose.
      console.error(`Resend send failed: ${response.status} ${body.slice(0, 500)}`);
      return { ok: false, reason: `Email provider returned ${response.status}.` };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: body?.id ?? null };
  } catch (error) {
    console.error("Resend send failed.", error);
    return { ok: false, reason: "Email provider is unreachable." };
  }
}
