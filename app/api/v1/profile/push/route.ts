import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import {
  countActivePushSubscriptions,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/data/push-subscriptions";
import { getWebPushPublicKey, isWebPushConfigured } from "@/lib/notifications/web-push";

async function resolveUser(request: Request, scope: "read:profile" | "write:profile" = "read:profile") {
  const auth = await authorizeApiRequest(request, scope, { allowMissingBearer: true });

  if (auth.response) {
    return { user: null, response: auth.response };
  }

  const user = auth.principal ?? (await getCurrentOfbUser());

  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Sign in is required." }, { status: 401 }) };
  }

  return { user, response: null };
}

export async function GET(request: Request) {
  const { user, response } = await resolveUser(request);

  if (!user) {
    return response;
  }

  const activeCount = await countActivePushSubscriptions(user.email);

  return NextResponse.json({
    configured: isWebPushConfigured(),
    publicKey: getWebPushPublicKey(),
    activeCount,
  });
}

export async function POST(request: Request) {
  const { user, response } = await resolveUser(request, "write:profile");

  if (!user) {
    return response;
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: "Web Push is not configured on this server." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = pushSubscriptionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Push subscription is invalid.", issues: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  const result = await savePushSubscription(parsed.data, user.email, request.headers.get("user-agent"));

  if (!result.saved) {
    return NextResponse.json({ error: "Push subscription could not be saved." }, { status: 500 });
  }

  return NextResponse.json({ subscribed: true, activeCount: result.activeCount });
}

export async function DELETE(request: Request) {
  const { user, response } = await resolveUser(request, "write:profile");

  if (!user) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = pushUnsubscribeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Push endpoint is invalid.", issues: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  const result = await removePushSubscription(parsed.data.endpoint, user.email);

  return NextResponse.json({ subscribed: false, activeCount: result.activeCount });
}
