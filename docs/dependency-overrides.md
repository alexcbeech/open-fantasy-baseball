# Dependency security overrides

The full-tree moderate-severity audit and registry signature checks remain enabled.
These overrides bridge upstream constraints as of November 3, 2026:

- Neon Auth 0.7.0-beta pins Better Auth 1.7.6. Keep `better-auth`, its core,
  and its OAuth provider together on 1.7.7, the first patch for the OAuth
  account takeover and PostgreSQL rate-limit issues. Its remaining adapters
  follow Better Auth's exact patch dependencies.
- React Email Components pins renderer 2.0.6. Renderer 2.2.0 uses html-to-text
  10, which replaces the unpatched deepmerge dependency with deepmerge-ts.
- ESLint and TypeScript ESLint's modern minimatch consumers use 11.0.1, the
  first patch for glob pattern amplification. Their named export API is retained.
- ESLint's import, React, and accessibility plugins still require minimatch 3's
  callable CommonJS API. Their parent-scoped override uses the local
  `tools/minimatch-compat` adapter, which delegates matching and helpers to the
  same patched minimatch 11.0.1 through an npm alias. A global minimatch 11
  override would break these plugins. No upstream source is copied or patched;
  compatibility tests exercise the API resolved from each plugin and real lint
  enforcement. Minimatch 11 also removed `makeRe`; the adapter supports the
  `.makeRe(pattern).test(path)` call used by `import/no-internal-modules` by
  delegating to `Minimatch.match`, without generating a regular expression.

Remove each override when its parent accepts patched dependencies and both
the audit and compatibility checks pass. Remove the local adapter and its tests
when all three legacy plugins support the modern minimatch API.

Advisories: [OAuth state account takeover](https://github.com/advisories/GHSA-965c-763c-88jm),
[OAuth proxy account takeover](https://github.com/advisories/GHSA-r4xp-prcw-77qf),
[PostgreSQL rate limits](https://github.com/advisories/GHSA-44jh-23m7-hpcf),
[deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249).
