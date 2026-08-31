# Contributing to Open Fantasy Baseball

Thanks for helping improve OFB. Keep changes focused, reviewable, and covered by the checks that protect league data and authenticated user flows.

## Development setup

1. Install Node.js 24. If you use `nvm`, run `nvm use` from the repository root.
2. Install the locked dependencies with `npm ci`.
3. Run `npm run dev`. Without `DATABASE_URL`, OFB uses bundled mock data and does not require sign-in.
4. For database-backed development, copy `.env.example` to `.env.local`, start the local services with `docker compose up -d`, and run `npm run db:setup`.

PowerShell installations that block the `npm.ps1` shim can use `npm.cmd` in place of `npm`.

Never commit `.env.local`, real credentials, production data, or logs containing sensitive values. Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.

## Making a change

1. Create a descriptive topic branch from the latest `main`. Maintainer branches generally use the `feature/` prefix; fork contributors may use their own convention.
2. Keep the change scoped. Do not overwrite unrelated work in the checkout.
3. Add focused tests when behavior changes.
4. Add database changes as a new numbered migration in `db/migrations/`. Do not edit a migration that may already have run in another environment.
5. Update the README, API description, or operational documentation when behavior or setup changes.

## Verification

Run these checks before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Also run `npm run test:e2e` for changes to user flows, routing, authentication, or PWA behavior. If a check cannot run, explain why in the pull request.

## Pull requests

- Explain the user-facing or operational reason for the change.
- Keep generated output, local settings, and secrets out of the diff.
- Include screenshots or recordings for visible UI changes.
- Call out schema, environment-variable, authorization, security, or deployment effects.
- Link the issue being addressed when one exists.

Contributors without permission to push to the upstream repository can open a pull request from a fork.

## Licensing

Unless stated otherwise, contributions submitted to Open Fantasy Baseball are licensed under the [Apache License 2.0](LICENSE). Only submit work that you have the right to contribute, and preserve applicable third-party attribution and license notices.
