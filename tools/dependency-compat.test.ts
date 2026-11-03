import { createRequire } from "node:module";
import { createElement } from "react";
import { render, toPlainText } from "@react-email/render";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("patched ESLint glob dependencies", () => {
  for (const plugin of ["eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-jsx-a11y"]) {
    it(`preserves the callable minimatch API used by ${plugin}`, () => {
      const pluginRequire = createRequire(require.resolve(plugin));
      const match = pluginRequire("minimatch");
      expect(match("src/player.ts", "src/**/*.ts")).toBe(true);
      expect(match("src/player.js", "src/**/*.ts")).toBe(false);
      expect(match("RenderPlayer", "Render*")).toBe(true);
      expect(match.makeRe("src/**/*.ts").test("src/player.ts")).toBe(true);
      expect(match.makeRe("src/**/*.ts").test("src/player.js")).toBe(false);
      expect(new match.Minimatch("src/**/*.ts").match("src/player.ts")).toBe(true);
      expect(match.defaults({ nocase: true })("PLAYER.TS", "*.ts")).toBe(true);
    });
  }
});

it("still enforces import glob restrictions through the real ESLint plugin", () => {
  const linter = new Linter();
  const messages = linter.verify('import player from "players/private/model";', {
    plugins: { import: require("eslint-plugin-import") },
    rules: { "import/no-internal-modules": ["error", { forbid: ["players/private/**"] }] },
  });
  expect(messages.map((message) => message.ruleId)).toEqual(["import/no-internal-modules"]);
});

it("renders React Email HTML and converts it to plain text with the patched renderer", async () => {
  const html = await render(createElement("p", null, "Your league invitation is ready."));
  expect(html).toContain("Your league invitation is ready.");
  expect(toPlainText(html)).toBe("Your league invitation is ready.");
});
