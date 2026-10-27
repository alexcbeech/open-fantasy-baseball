# Security review — October 2026

Reviewed on 2026-10-27 against main `d26c681` and the security-fix branch.
This is a source, dependency, repository-control, and local-preview review;
it is not a production penetration test or evidence that exploitation occurred.
The fixes below require merge and deployment before they protect production.

## Baseline

- Full `npm audit`: 13 affected packages (1 critical, 10 high, 2 moderate).
- Production-only audit: 9 affected packages (1 critical, 8 high).
  Counts include parent packages affected through vulnerable dependencies;
  they are not counts of distinct exploitable vulnerabilities.
- GitHub had 16 open Dependabot alerts. Several pending dependency PRs
  failed the production audit, so individual updates could not clear CI.
- GitHub secret scanning and CodeQL returned no open alerts. The latest
  main-branch CodeQL analysis was 2026-10-18. This is scanner evidence,
  not a guarantee that no credential or source vulnerability exists.
- Dependabot security updates, secret scanning, and push protection were
  enabled. Main required up-to-date `verify` and `e2e` checks, enforced
  administrator protections, and disallowed force pushes and deletion.
- The latest recorded production deployment used `d26c681` from September 28.

## Fixed in this branch

1. **Vulnerable dependencies.** Upgrade Next.js to 16.4.3, React/React DOM
   to 19.3.1, Sharp to 0.35.5, Neon Auth to 0.7.0-beta, Zod to 4.6.7,
   Vercel Blob to 2.8.2, and compatible development/transitive releases.
   The Next.js and Sharp SVG advisories describe possible remote code
   execution on glibc-based Linux. Other Next.js RCE advisories have specific
   `ImageResponse` or Cache Component prerequisites; no such usage was found
   in OFB. Version matching alone does not prove application exploitability.
2. **Decode images only after format checks.** Previously even a rejected
   SVG reached Sharp's native metadata parser. Check JPEG/PNG/WebP signatures
   before any decoder call, while retaining byte/pixel limits, animation
   rejection, metadata stripping, and WebP output.
3. **Push subscription SSRF.** Previously any syntactically valid URL could
   be saved and passed to the server's push client. Restrict registration
   and delivery to HTTPS endpoints operated by supported browser push
   services (Google, Mozilla, Apple, Microsoft), reject credentials and
   alternate ports, bound keys, and time out delivery after ten seconds.
   Recheck stored endpoints and prune unsafe legacy destinations on delivery.
   Unsubscription remains able to remove legacy endpoints.
4. **Mutation origin checks.** Reject foreign/opaque browser origins and
   cross-site fetch metadata for unsafe `/api/` requests in the shared proxy.
   Preserve same-origin mutations, safe OAuth redirects, and API clients
   without browser origin headers. Authorization remains required in handlers.
5. **Anonymous league creation during auth misconfiguration.** Require an
   authenticated identity before parsing league creation input, even when
   the production auth environment is absent. Development demo users still
   use the same authenticated handler contract.
6. **Enrollment enforcement and identity linking.** Enforce closed signup
   in the shared OFB identity-mapping function so an upstream OAuth session
   landing outside OFB's callback cannot create an account. An explicit,
   redeemable invitation is the exception. Both email signup and OAuth
   callback provision through that guard. Require verified email before a
   new provider identity attaches to an existing account by email; existing
   stable provider links continue to work. Normalize encoded auth paths
   before blocking direct signup and provider-administration endpoints.
7. **Audit development dependencies in CI.** Fail the dependency gate at
   moderate severity across the full tree, including Vite/Vitest tooling.

The Zod override keeps every copy on the patched direct dependency, including
the exact vulnerable versions still declared by Neon and Vercel packages.
Neon Auth UI 0.4.0-beta declares an older Auth peer; the Auth override keeps
one SDK version throughout the tree. OFB uses its own forms and the server
adapter. Remove these overrides when upstream constraints are corrected and
the lockfile remains free of advisories.

Primary advisories:

- [Next.js SVG optimization RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw)
- [Sharp/librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- [Next.js Cache Component RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr)
- [Zod memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)

## Verification

- Updated full-tree `npm audit`: zero vulnerabilities.
- Registry verification: 659 package signatures and 224 attestations verified.
- Lint and TypeScript checks pass. Lint reports one existing React-effect
  cleanup warning in `app/admin/feedback-reply-composer.tsx`.
- Regression coverage includes native-decoder isolation, push registration
  and legacy-delivery SSRF, mutation origins, fail-closed league creation,
  identity linking, invite enrollment, OAuth callbacks, and encoded auth paths.
- Production build, complete unit/E2E suites, and PR CI are required before
  handoff. Final results are recorded in the pull request verification notes.

## Remaining operational limits

- Rate limiting is per process, not distributed across serverless instances.
  Use a shared store or platform-level controls if abuse volume warrants it.
- CSP is still report-only and permits inline scripts/styles. An enforced
  nonce-based policy needs a separately verified rollout.
- OAuth provider-console settings, database roles, hosting/network controls,
  and historical production access logs were outside this local review.
- No production credentials, schema, user data, or security settings were changed.
- Major tooling migrations (ESLint 10, TypeScript 7, Vitest 5) are separate
  compatibility work; supported current-major releases were patched here.
- Recheck after dependency upgrades and regularly while the app is active.
