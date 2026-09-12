import type { FeedbackRecord } from "@/lib/data/feedback-schema";

type FeedbackReference = Pick<FeedbackRecord, "id" | "message" | "category">;
const site = "https://openfantasy.app";
const escape = (text: string) => text.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
const paragraphs = (text: string) => escape(text.trim()).replace(/\r?\n/g, "<br />");

// Preview and sender share this template; retries retain the persisted payload.
export function feedbackEmailText(body: string, feedback: FeedbackReference) {
  return `${body.trim()}\n\nYour original feedback\n${feedback.category === "issue" ? "Issue" : "Idea"} · Reference ${feedback.id}\n${feedback.message}\n\n—\nOpen Fantasy Baseball\nYou can reply directly to this email.\n${site}`;
}

export function feedbackEmailHtml(body: string, feedback: FeedbackReference) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef0f4;color:#14213d;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef0f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce1e9;border-radius:12px">
<tr><td style="padding:18px 16px;background:#14213d;border-radius:12px 12px 0 0;border-bottom:4px solid #e63946">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="44" style="width:44px;vertical-align:middle"><img src="${site}/icons/icon-192.png" width="44" height="44" alt="OFB logo" style="display:block;border:0"></td>
<td style="padding-left:10px;vertical-align:middle;color:#ffffff;font-size:16px;line-height:22px;font-weight:bold;white-space:nowrap">Open Fantasy Baseball</td>
</tr></table></td></tr><tr><td style="padding:28px 24px;font-size:16px;line-height:26px;overflow-wrap:anywhere;word-break:break-word">
<div>${paragraphs(body)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;background:#f4f6f9;border-left:3px solid #4c74bb"><tr><td style="padding:18px">
<h2 style="margin:0 0 8px;font-size:15px;line-height:22px">Your original feedback</h2>
<p style="margin:0 0 12px;font-size:12px;line-height:18px;color:#526078">${feedback.category === "issue" ? "Issue" : "Idea"} · Reference ${escape(feedback.id)}</p>
<div style="font-size:14px;line-height:23px">${paragraphs(feedback.message)}</div></td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#526078">Have more to share? Reply directly to this email.</p></td></tr>
<tr><td style="padding:20px 24px;border-top:1px solid #dce1e9;font-size:12px;line-height:20px;color:#526078">
<a href="${site}" style="color:#315c9f;text-decoration:underline;font-weight:bold">Open Fantasy Baseball</a><br>Thank you for helping us improve OFB.</td></tr>
</table></td></tr></table></body></html>`;
}
