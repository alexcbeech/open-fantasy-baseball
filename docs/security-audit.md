# Dependency Audit And Upgrade Plan

Last reviewed: 2026-07-02 (`npm audit`, 5 moderate, 0 high/critical).

All current advisories are in **transitive** dependencies. `npm audit fix --force`
is **not** an acceptable remedy: its only offered path downgrades `next` to
`9.3.3`, which would break the entire app. The plan below tracks the upstream
fixes instead.

## Findings

### 1. `postcss` < 8.5.10 — XSS via unescaped `</style>` in CSS stringify output
- Advisory: GHSA-qx2v-qp2m-jg93 (moderate).
- Path: `next@15.5.19` → bundled `postcss`.
- Exposure in OFB: **low / not runtime-exploitable.** PostCSS runs at build time
  over first-party stylesheets (`app/globals.css`); OFB never stringifies
  untrusted CSS. The advisory requires processing attacker-controlled CSS.
- Plan: bump `next` within the 15.x line as soon as a patch ships that vendors
  `postcss >= 8.5.10`. Re-run `npm audit` after each Next upgrade.

### 2. `better-auth` < 1.6.2 — OAuth callback accepts mismatched `state` without PKCE
- Advisory: GHSA-wxw3-q3m9-c3jr (moderate).
- Path: `@neondatabase/auth@0.4.2-beta` → `better-auth@1.4.18` (also via
  `@neondatabase/auth-ui`).
- Exposure in OFB: **low today.** OFB currently uses Neon Auth email/password
  sign-in; the vulnerable cookie-backed-state-without-PKCE OAuth callback path is
  not yet wired (social login is still pending — see TODO "OIDC/OAuth2 login with
  PKCE"). The risk becomes real once a social/OAuth provider is enabled, so this
  must be resolved before that work ships.
- Plan: upgrade `@neondatabase/auth` when a release that depends on
  `better-auth >= 1.6.2` is published (the package is a pinned beta today). When
  wiring OAuth, ensure PKCE is enabled so the mismatched-state path is never
  exercised.

## Notes

- `web-push` (added for push notifications) introduced **no** advisories.
- `.npmrc` sets `legacy-peer-deps=true` because `@neondatabase/auth@0.4.2-beta`
  declares a `next >= 16` peer while the app runs Next 15. Revisit once the SDK
  leaves beta and relaxes/updates that peer range.
- CI runs `npm ci` on every push/PR; add a periodic `npm audit` review to the
  cadence (or a scheduled workflow) once the app approaches production.
