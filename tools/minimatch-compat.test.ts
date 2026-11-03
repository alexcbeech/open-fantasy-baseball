import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { Linter } from "eslint";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Options = { platform?: "win32"; nocase?: boolean; allowWindowsEscape?: boolean };
type Matcher = {
  (path: string, pattern: string, options?: Options): boolean;
  Minimatch: new (pattern: string, options?: Options) => { match(path: string): boolean };
  defaults(options: Options): Matcher;
  makeRe(pattern: string, options?: Options): { test(path: string): boolean };
};

// Exercise the adapter's Windows branch on every CI host. The explicit matcher
// platform also tells upstream minimatch how to interpret Windows file paths.
function loadAdapter(platform: "win32" | "linux") {
  const commonJsModule = { exports: {} };
  runInNewContext(readFileSync(new URL("./minimatch-compat/index.js", import.meta.url), "utf8"), {
    module: commonJsModule, require, process: { platform },
  });
  return commonJsModule.exports as Matcher;
}

it.each(["direct", "class", "defaults", "makeRe"] as const)(
  "preserves Windows path separators in the legacy %s API",
  (form) => {
    const match = loadAdapter("win32");
    const pattern = "C:\\review\\private\\**\\*.js";
    const options = { platform: "win32" as const };
    const matches = form === "direct" ? (path: string) => match(path, pattern, options)
      : form === "class" ? (path: string) => new match.Minimatch(pattern, options).match(path)
      : form === "defaults" ? (path: string) => match.defaults(options)(path, pattern)
      : (path: string) => match.makeRe(pattern, options).test(path);
    expect(matches("C:\\review\\private\\nested\\model.js")).toBe(true);
    expect(matches("C:\\review\\public\\model.js")).toBe(false);
  },
);

it("retains explicit Windows escaping and POSIX escaping", () => {
  const match = loadAdapter("win32");
  expect(match("C:/review/*.js", "C:/review/\\*.js", {
    platform: "win32", allowWindowsEscape: true,
  })).toBe(true);
  expect(match.defaults({ platform: "win32" })("C:/review/*.js", "C:/review/\\*.js", {
    allowWindowsEscape: true,
  })).toBe(true);
  expect(loadAdapter("linux")("src/*.js", "src/\\*.js")).toBe(true);
});

it("leaves modern minimatch consumers and their default options unchanged", () => {
  const modern = require("minimatch-modern");
  const legacy = loadAdapter("win32");
  const pattern = "C:\\review\\private\\**";
  const file = "C:\\review\\private\\model.js";
  expect(legacy).not.toBe(modern.minimatch);
  expect(new modern.Minimatch(pattern, { platform: "win32" }).match(file)).toBe(false);
  expect(new legacy.Minimatch(pattern, { platform: "win32" }).match(file)).toBe(true);
});

it("enforces real import path restrictions and glob exceptions on the host platform", () => {
  const fixture = mkdtempSync(join(tmpdir(), "ofb-minimatch-"));
  try {
    mkdirSync(join(fixture, "src"));
    mkdirSync(join(fixture, "private"));
    writeFileSync(join(fixture, "private", "model.js"), "export default 1;\n");
    writeFileSync(join(fixture, "private", "public.js"), "export default 1;\n");
    const linter = new Linter({ cwd: fixture });
    const verify = (file: string) => linter.verify(`import value from "../private/${file}.js";`, {
      plugins: { import: require("eslint-plugin-import") },
      rules: {
        "import/no-restricted-paths": ["error", {
          basePath: fixture,
          zones: [{ target: "./src/**", from: "./private/**", except: ["**/public.js"] }],
        }],
      },
    }, { filename: join(fixture, "src", "consumer.js") });
    expect(verify("model").map((message) => message.ruleId)).toEqual(["import/no-restricted-paths"]);
    expect(verify("public")).toEqual([]);
  } finally {
    if (dirname(fixture) === tmpdir() && basename(fixture).startsWith("ofb-minimatch-")) {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});
