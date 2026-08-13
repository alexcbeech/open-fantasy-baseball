<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Git workflow

For every task that changes repository files:

- Create and work on a dedicated branch before making changes. Use the `feature/` prefix unless the user specifies another branch name.
- Never commit or push changes directly to `main`.
- Commit the completed work to the dedicated branch and push that branch to the remote.
- Create a pull request targeting `main`. Work is not considered complete until the pull request has been created and its URL has been reported to the user.
- If the task begins with uncommitted changes on `main`, create the dedicated branch immediately so those changes are carried onto it before continuing.

Read-only investigation and advisory tasks that do not change repository files do not require a branch or pull request.
