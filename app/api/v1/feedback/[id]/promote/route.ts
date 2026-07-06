import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { getFeedbackById, linkFeedbackIssue } from "@/lib/data/feedback";
import type { FeedbackRecord } from "@/lib/data/feedback-schema";
import { isUuid } from "@/lib/db/client";
import { createGithubIssue, isGithubConfigured } from "@/lib/github/issues";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

// Build a public-safe issue: message + page path only. Email, user agent, and
// metadata deliberately stay out of the (public) issue.
function buildIssue(feedback: FeedbackRecord) {
  const typeLabel = feedback.category === "issue" ? "Issue" : "Idea";
  const firstLine = feedback.message.split("\n")[0].trim();
  const title = `[${typeLabel}] ${firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine}`;

  const body = [
    feedback.message,
    "",
    "---",
    `- Type: ${typeLabel}`,
    feedback.pagePath ? `- Reported from: \`${feedback.pagePath}\`` : null,
    `- Feedback ID: ${feedback.id}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { title, body, labels: [feedback.category === "issue" ? "bug" : "enhancement"] };
}

export async function POST(_request: Request, { params }: RouteContext) {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
  }

  if (!isGithubConfigured()) {
    return NextResponse.json(
      { error: "GitHub is not configured. Set GITHUB_TOKEN and GITHUB_FEEDBACK_REPO." },
      { status: 503 },
    );
  }

  const feedback = await getFeedbackById(id);

  if (!feedback) {
    return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
  }

  if (feedback.githubIssueUrl) {
    return NextResponse.json({ error: "This feedback already has a linked issue.", feedback }, { status: 409 });
  }

  let issue: { number: number; url: string };

  try {
    issue = await createGithubIssue(buildIssue(feedback));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GitHub issue could not be created." },
      { status: 502 },
    );
  }

  const updated = await linkFeedbackIssue(id, issue);

  if (!updated) {
    return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
  }

  return NextResponse.json({ feedback: updated });
}
