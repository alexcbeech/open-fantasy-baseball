const GITHUB_API = "https://api.github.com";

/** GitHub issue creation needs a token and a target repo ("owner/name"). */
export function isGithubConfigured() {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_FEEDBACK_REPO);
}

type CreateIssueInput = {
  title: string;
  body: string;
  labels?: string[];
};

export async function createGithubIssue(input: CreateIssueInput): Promise<{ number: number; url: string }> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_FEEDBACK_REPO;

  if (!token || !repo) {
    throw new Error("GitHub is not configured.");
  }

  const response = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": "open-fantasy-baseball",
    },
    body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub responded ${response.status}. ${detail.slice(0, 300)}`.trim());
  }

  const issue = (await response.json()) as { number: number; html_url: string };

  return { number: issue.number, url: issue.html_url };
}
