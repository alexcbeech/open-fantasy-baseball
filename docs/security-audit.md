# Dependency Security Audit

Last reviewed: 2026-08-30 (`npm audit`, 0 vulnerabilities).

## Current Status

- `npm audit` reports 0 info, low, moderate, high, or critical advisories
  across the current lockfile.
- GitHub Dependabot reports no open vulnerability alerts, and automated
  security updates are enabled.
- GitHub secret scanning and push protection are enabled with no open alerts.
- CodeQL reports no open findings.
- CI checks production dependencies at `high` severity and verifies package
  registry signatures on every push and pull request.

## Resolved Findings

The July 2026 review tracked five moderate transitive advisories:

1. `postcss < 8.5.10`, previously bundled through Next.js 15, was resolved by
   the Next.js 16 upgrade. The app now uses Next.js 16.3.3.
2. `better-auth < 1.6.2`, previously pulled through
   `@neondatabase/auth@0.4.2-beta`, was resolved by the Neon Auth 0.5 beta
   upgrade. The installed dependency tree now uses `better-auth@1.6.23`.

No forced downgrade or audit override was needed.

## Remaining Maintenance Notes

- `@neondatabase/auth@0.5.0-beta` transitively installs deprecated
  `@react-email/*` packages through `@neondatabase/auth-ui` and
  `@daveyplate/better-auth-ui`. They have no current security advisories, but
  the chain should be rechecked when Neon Auth publishes its next release.
- Social/OIDC login is not enabled yet. When implemented, require OAuth state
  validation and PKCE and add callback-path integration tests before release.
- The project and CI require Node.js 24. Local development should use the same
  major version so installs, native dependencies, and builds match CI.
- Re-run this review after Next.js or Neon Auth upgrades and at least monthly
  while the application is under active development.
