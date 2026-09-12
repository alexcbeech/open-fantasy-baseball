"use client";

import { useState } from "react";
import type { FeedbackRecord } from "@/lib/data/feedback-schema";
import type { FeedbackReply, ReplySettings } from "@/lib/data/feedback-reply-schema";
import { feedbackEmailHtml } from "@/lib/notifications/feedback-email";

export function FeedbackReplyComposer({ feedback, onClosed }: { feedback: FeedbackRecord; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<FeedbackReply[]>([]);
  const [settings, setSettings] = useState<ReplySettings | null>(null);
  const [draft, setDraft] = useState<FeedbackReply | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const url = `/api/v1/feedback/${feedback.id}/replies`;
  const dirty = draft && (subject !== draft.subject || body !== draft.body);

  function select(reply: FeedbackReply | null) {
    setDraft(reply); setSubject(reply?.subject ?? ""); setBody(reply?.body ?? ""); setPreview(false);
  }
  async function api(method: string, data?: unknown) {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
    return result as { replies: FeedbackReply[]; settings: ReplySettings; reply: FeedbackReply };
  }
  async function load() {
    const result = await api("GET"); setReplies(result.replies); setSettings(result.settings);
    select(result.replies.find((reply) => reply.status === "draft") ?? null);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check your connection and try again."); }
    finally { setBusy(false); }
  }
  function remember(reply: FeedbackReply) {
    setReplies((current) => [reply, ...current.filter((item) => item.id !== reply.id)]);
    setDraft(reply); setSubject(reply.subject); setBody(reply.body);
  }
  async function save() {
    if (!draft) return;
    const result = await api("PATCH", { id: draft.id, revision: draft.revision, subject, body });
    remember(result.reply); setNotice("Draft saved.");
    return result.reply;
  }
  async function send(reply: FeedbackReply, closeFeedback: boolean) {
    try {
      const result = await api("PUT", { id: reply.id, revision: reply.revision, closeFeedback });
      if (result.reply.closeFeedback) onClosed();
      await load(); setNotice("Email accepted by OFB’s email provider. Inbox delivery is not yet confirmed.");
    } catch (failure) {
      // A timeout can occur after acceptance. Reload persisted state before
      // presenting a retry; never turn an uncertain send into a new draft.
      await load().catch(() => undefined);
      throw failure;
    }
  }
  const inputId = `reply-${feedback.id}`;
  return <div className="feedback-replies">
    <button className="secondary-button" type="button" aria-expanded={open} disabled={busy}
      onClick={() => { if (open) setOpen(false); else { setOpen(true); if (!settings) void run(load); } }}>Reply by email / history</button>
    {open ? <section aria-label="Feedback email reply" className="feedback-reply-panel">
      <h3>Email reply</h3>
      <p className="subtle">To: {feedback.userEmail ?? "No email address recorded"}</p>
      {settings && !settings.configured ? <p className="status-banner">Sending is unavailable until OFB’s sender and Reply-To inbox are configured. You can save drafts.</p> : null}
      {error ? <p className="status-banner bad" role="alert">{error}</p> : null}
      {notice ? <p className="status-banner" role="status">{notice}</p> : null}
      <div className="feedback-reply-buttons">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(load)}>{dirty ? "Discard changes and reload" : "Reload replies"}</button>
        {!draft && feedback.userEmail ? <button type="button" className="secondary-button" disabled={busy}
          onClick={() => void run(async () => { remember((await api("POST")).reply); })}>New draft</button> : null}
      </div>
      {draft ? <div>
        <label htmlFor={`${inputId}-subject`}>Subject</label>
        <input id={`${inputId}-subject`} value={subject} maxLength={200} disabled={busy} onChange={(event) => { setSubject(event.target.value); setPreview(false); }} />
        <label htmlFor={`${inputId}-body`}>Message</label>
        <textarea id={`${inputId}-body`} value={body} rows={9} maxLength={10000} disabled={busy}
          placeholder="Paste your draft here, then review it before sending."
          onChange={(event) => { setBody(event.target.value); setPreview(false); }} />
        <p className="subtle">{dirty ? "Unsaved changes" : "Draft saved"} · {body.length}/10,000 characters</p>
        <div className="feedback-reply-buttons">
          <button className="secondary-button" type="button" disabled={busy || !subject.trim()}
            onClick={() => void run(async () => { await save(); })}>Save draft</button>
          <button className="secondary-button" type="button" disabled={busy || !body.trim() || !subject.trim()}
            onClick={() => void run(async () => { if (!dirty || await save()) setPreview(true); })}>Preview email</button>
        </div>
        {preview ? <div className="feedback-email-preview">
          <h4>Review before sending</h4>
          <p>From: {settings?.from ?? "Not configured"}<br />Reply-To: {settings?.replyTo ?? "Not configured"}<br />To: {draft.recipient}<br />Subject: {draft.subject}</p>
          <iframe title="OFB email preview" sandbox="" srcDoc={feedbackEmailHtml(draft.body, feedback)} />
          <div className="feedback-reply-buttons">
            <button type="button" className="primary-button" disabled={busy || !settings?.configured} onClick={() => void run(() => send(draft, false))}>Send email</button>
            <button type="button" className="secondary-button" disabled={busy || !settings?.configured} onClick={() => void run(() => send(draft, true))}>Send and close feedback</button>
          </div>
        </div> : null}
      </div> : null}
      <h4>Reply history</h4>
      {replies.filter((reply) => reply.status !== "draft").map((reply) => <article className="feedback-reply-history" key={reply.id}>
        <strong>{reply.subject}</strong>
        <p className="subtle">{reply.status === "sent" ? "Sent · accepted by email provider" : reply.status === "sending" ? "Sending · reload to check" : "Send unconfirmed"}<br />
          {reply.senderEmail ?? reply.authorEmail} · {new Date(reply.sentAt ?? reply.firstAttemptAt ?? reply.createdAt).toLocaleString()}<br />To: {reply.recipient}</p>
        <p className="feedback-admin-message">{reply.body}</p>
        {reply.error ? <p role="status">{reply.error}</p> : null}
        {reply.status !== "sent" ? <button type="button" className="secondary-button" disabled={busy || !settings?.configured}
          onClick={() => void run(() => send(reply, reply.closeFeedback))}>Retry saved reply</button> : null}
      </article>)}
      {!replies.some((reply) => reply.status !== "draft") ? <p className="subtle">No emails sent yet.</p> : null}
    </section> : null}
  </div>;
}
