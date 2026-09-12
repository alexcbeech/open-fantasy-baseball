import { describe, expect, it } from "vitest";
import { feedbackEmailHtml, feedbackEmailText } from "./feedback-email";
const feedback = { id: "feedback-123", category: "issue" as const, message: 'Original question\n<img src=x onerror="bad"> & details' };
describe("feedback email", () => {
  it("escapes both messages and retains line breaks", () => {
    const html = feedbackEmailHtml('Hello\n<script>alert("oops")</script> & thanks', feedback);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Hello<br />&lt;script&gt;");
    expect(html).toContain("&amp; thanks");
    expect(html).toContain("Original question<br />&lt;img");
  });
  it("includes the original reference in HTML and plain text with accessible branding", () => {
    const html = feedbackEmailHtml(" Thanks! ", feedback);
    expect(html).toContain("Your original feedback");
    expect(html).toContain("Issue · Reference feedback-123");
    expect(html).toContain('src="https://openfantasy.app/icons/icon-192.png"');
    expect(html).toContain('alt="OFB logo"');
    const text = feedbackEmailText(" Thanks! ", feedback);
    expect(text).toContain("Thanks!\n\nYour original feedback");
    expect(text).toContain(feedback.message);
    expect(text).toContain(feedback.id);
    expect(text).toContain("reply directly to this email");
  });
});
