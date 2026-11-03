// ESLint's legacy plugins require a callable CommonJS export. Delegate all
// matching and helper APIs to the patched upstream implementation.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This entry point must expose the legacy CommonJS API.
const modern = require("minimatch-modern");
const legacyOptions = (options = {}) => ({
  windowsPathsNoEscape: process.platform === "win32" && !options.allowWindowsEscape,
  ...options,
});
function createMatcher(defaults = {}) {
  const optionsFor = (options) => legacyOptions({ ...defaults, ...options });
  const match = (path, pattern, options) => modern.minimatch(path, pattern, optionsFor(options));
  class LegacyMinimatch extends modern.Minimatch {
    constructor(pattern, options) {
      super(pattern, optionsFor(options));
    }
  }
  return Object.assign(match, modern, {
    minimatch: match,
    Minimatch: LegacyMinimatch,
    defaults: (options) => createMatcher({ ...defaults, ...options }),
    filter: (pattern, options) => modern.filter(pattern, optionsFor(options)),
    match: (paths, pattern, options) => modern.match(paths, pattern, optionsFor(options)),
    // import/no-internal-modules only uses makeRe(...).test(path). Minimatch 11
    // removed RegExp generation; delegate that call shape to its safe matcher.
    makeRe: (pattern, options) => {
      const matcher = new LegacyMinimatch(pattern, options);
      return { test: (path) => matcher.match(path) };
    },
  });
}
module.exports = createMatcher();
