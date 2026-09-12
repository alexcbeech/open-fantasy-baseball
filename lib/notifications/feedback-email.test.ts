import { describe, expect, it } from "vitest";
import { feedbackEmailHtml, feedbackEmailText } from "./feedback-email";
describe("feedback email", () => {
  it("escapes pasted HTML while retaining line breaks and a branded footer", () => {
    const html = feedbackEmailHtml('Hello\n<script>alert("oops")</script> & thanks');
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hello\n&lt;script&gt;");
    expect(html).toContain("&amp; thanks");
    expect(feedbackEmailText(" Thanks! ")).toContain("Thanks!\n\n—\nOpen Fantasy Baseball");
  });
});
