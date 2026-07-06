import { NextResponse } from "next/server";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { feedbackSubmissionSchema, submitFeedback } from "@/lib/data/feedback";

export async function POST(request: Request) {
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
