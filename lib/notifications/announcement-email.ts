import type { AnnouncementContent } from "@/lib/data/admin-announcement-schema";

const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
export function announcementEmailText(content: AnnouncementContent) {
  return `${content.body.trim()}${content.buttonUrl ? `\n\n${content.buttonLabel}: ${content.buttonUrl}` : ""}\n\n—\nOpen Fantasy Baseball\nYou can reply directly to this email.\nhttps://openfantasy.app`;
}
export function announcementEmailHtml(content: AnnouncementContent) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#eef0f4;color:#14213d;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:white;border:1px solid #dce1e9;border-radius:12px">
<tr><td style="padding:18px 24px;background:#14213d;color:white;border-bottom:4px solid #e63946;font-weight:bold"><img src="https://openfantasy.app/icons/icon-192.png" width="36" height="36" alt="OFB logo" style="vertical-align:middle;margin-right:10px">Open Fantasy Baseball</td></tr>
<tr><td style="padding:28px 24px;font-size:16px;line-height:26px;overflow-wrap:anywhere"><h1 style="font-size:22px;line-height:30px;margin:0 0 20px">${escape(content.subject)}</h1>
${escape(content.body.trim()).replace(/\r?\n/g, "<br>")}
${content.buttonUrl ? `<p style="margin-top:24px"><a href="${escape(content.buttonUrl)}" style="display:inline-block;padding:10px 18px;background:#14213d;color:white;border-radius:6px;text-decoration:none">${escape(content.buttonLabel)}</a></p>` : ""}
</td></tr><tr><td style="padding:20px 24px;border-top:1px solid #dce1e9;font-size:12px;line-height:20px;color:#526078"><a href="https://openfantasy.app">Open Fantasy Baseball</a><br>You can reply directly to this email.</td></tr></table></td></tr></table></body></html>`;
}
