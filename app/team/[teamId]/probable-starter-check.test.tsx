import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProbableStarterCheck } from "./probable-starter-check";

describe("ProbableStarterCheck", () => {
  it("renders an accessible green-check indicator", () => {
    const markup = renderToStaticMarkup(<ProbableStarterCheck />);

    expect(markup).toContain('class="probable-start-check"');
    expect(markup).toContain('aria-label="Scheduled to start today"');
    expect(markup).toContain("<circle");
  });
});
