import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { feedbackStatusUpdateSchema, updateFeedbackStatus } from "@/lib/data/feedback";
import { isUuid } from "@/lib/db/client";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = feedbackStatusUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Status could not be updated.",
        issues: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  const updated = await updateFeedbackStatus(id, parsed.data.status);

  if (!updated) {
    return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
  }

  return NextResponse.json({ feedback: updated });
}
