import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { sendPushToUser } from "@/lib/data/push-subscriptions";
import { isWebPushConfigured } from "@/lib/notifications/web-push";

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, "write:profile", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const user = auth.principal ?? (await getCurrentOfbUser());

  if (!user) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: "Web Push is not configured on this server." }, { status: 503 });
  }

  const summary = await sendPushToUser(user.email, {
    title: "Open Fantasy Baseball",
    body: "Push notifications are working. You'll get injury, trade, waiver, and lineup alerts here.",
    url: "/profile",
    tag: "ofb-test",
  });

  if (summary.sent === 0) {
    return NextResponse.json(
      {
        error:
          summary.failed > 0
            ? "No test notification could be delivered. Re-enable push on this device."
            : "No push subscriptions are registered for your account yet.",
        ...summary,
      },
      { status: summary.failed > 0 ? 502 : 404 },
    );
  }

  return NextResponse.json({ ok: true, ...summary });
}
