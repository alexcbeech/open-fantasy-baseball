// Shared by the preview and sender; user text is always escaped, never raw HTML.
export function feedbackEmailText(body: string) {
  return `${body.trim()}\n\n—\nOpen Fantasy Baseball\nA response to your OFB feedback. You can reply to this email.`;
}
export function feedbackEmailHtml(body: string) {
  const escape = (text: string) => text.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#14213d"><h2>Open Fantasy Baseball</h2><div style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(body.trim())}</div><hr><p>A response to your OFB feedback. You can reply to this email.</p></div>`;
}
