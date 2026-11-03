// ESLint's legacy plugins require a callable CommonJS export. Delegate all
// matching and helper APIs to the patched upstream implementation.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This entry point must expose the legacy CommonJS API.
const modern = require("minimatch-modern");
module.exports = Object.assign(modern.minimatch, modern);

// import/no-internal-modules only uses makeRe(...).test(path). Minimatch 11
// removed RegExp generation; preserve that call shape with its safe matcher.
module.exports.makeRe = (pattern, options) => {
  const matcher = new modern.Minimatch(pattern, options);
  return { test: (path) => matcher.match(path) };
};
