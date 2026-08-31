<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository workflow

- Never commit or push changes directly to `main`.
- Before changing files, create a descriptive topic branch. Maintainer branches generally use the `feature/` prefix; contributors working from forks may use their own convention.
- Preserve unrelated work already present in the working tree.
- Push a branch or create a pull request only when the requested delivery includes GitHub and the available credentials are authorized for the target repository. Otherwise, leave the work in a reviewable local commit and report the branch and commit.
- Read-only investigation and advisory tasks do not require a branch or pull request.

# Verification

- Use Node.js 24 and install the locked dependency tree with `npm ci` on a fresh checkout.
- Before handoff, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` for code changes.
- Run `npm run test:e2e` for changes to user flows, routing, authentication, or PWA behavior.
- Add or update focused tests when behavior changes. Report any skipped check and why it was not applicable or could not run.

# Data and security

- Never commit `.env.local`, credentials, access tokens, production data, or command output containing secrets. Use `.env.example` for placeholder configuration only.
- Add schema changes as a new numbered file under `db/migrations/`; do not rewrite migrations that may already have been applied.
- Keep API authorization, rate limiting, and audit behavior covered when changing protected routes or mutations.
