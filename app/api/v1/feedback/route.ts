import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { feedbackSubmissionSchema, listRecentFeedback, submitFeedback } from "@/lib/data/feedback";
import { clientKeyForRequest, isRateLimited } from "@/lib/rate-limit";

export async function GET() {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  const feedback = await listRecentFeedback();

  return NextResponse.json({ feedback });
}

export async function POST(request: Request) {
  // Feedback intake is intentionally open to signed-out users, so throttle it:
  // it writes to a PII table and feeds the admin triage queue.
  if (isRateLimited(`feedback:${clientKeyForRequest(request)}`, { limit: 20, windowMs: 10 * 60 * 1000 })) {
    return NextResponse.json({ error: "Too many feedback submissions. Please try again later." }, { status: 429 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = feedbackSubmissionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Feedback could not be submitted.",
        issues: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  const currentUser = await getCurrentOfbUser();

  const result = await submitFeedback(parsed.data, {
    userEmail: currentUser?.email ?? null,
    authUserId: currentUser?.userId ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
}
