"use client";

import { AdminSection } from "./admin-section";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminAnnouncement, AnnouncementContent, AnnouncementSettings } from "@/lib/data/admin-announcement-schema";
import { announcementContentSchema } from "@/lib/data/admin-announcement-schema";
import { announcementEmailHtml } from "@/lib/notifications/announcement-email";

const empty: AnnouncementContent = { subject: "", body: "", buttonLabel: "", buttonUrl: "" };
const endpoint = "/api/v1/admin/announcements";
export function AdminAnnouncementsPanel() {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [settings, setSettings] = useState<AnnouncementSettings | null>(null);
  const [testRecipient, setTestRecipient] = useState("");
  const [active, setActive] = useState<AdminAnnouncement | null>(null);
  const [content, setContent] = useState<AnnouncementContent>(empty);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [audience, setAudience] = useState<{ count: number; token: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load announcements.");
    setItems(data.announcements); setSettings(data.settings); setTestRecipient(data.testRecipient);
    return data.announcements as AdminAnnouncement[];
  }, []);
  useEffect(() => {
    // State changes happen after the network response, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(error => setError(error.message));
  }, [load]);
  useEffect(() => {
    if (!items.some(item => item.pending > 0 || item.unconfirmed > 0)) return;
    const interval = setInterval(() => { void load().catch(error => setError(error.message)); }, 10_000);
    return () => clearInterval(interval);
  }, [items, load]);
  function choose(item: AdminAnnouncement) {
    setActive(item); setContent({ subject: item.subject, body: item.body, buttonLabel: item.buttonLabel, buttonUrl: item.buttonUrl });
    setDirty(false); setAudience(null); setNotice("");
  }
  async function act(action: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, id: active?.id, revision: active?.revision, content, audienceToken: audience?.token,
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not complete this action.");
      if (action === "review") { setAudience(data.audience); return; }
      if (action === "test") { setNotice(`Test email accepted for sending to ${testRecipient}.`); return; }
      const updated = await load();
      const item = updated.find(item => item.id === data.id);
      if (item) choose(item);
      setNotice(action === "save" ? "Draft saved." : action === "create" ? "Draft created." : "Sending in the background. Refresh history to check progress.");
    } catch (error) { setError(error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  }
  const valid = announcementContentSchema.safeParse(content).success;
  const editable = active?.status === "draft";
  return <AdminSection title="Email Announcements" id="announcements-heading" className="announcement-panel">
    <div className="section-title">
      <button className="secondary-button" type="button" disabled={busy || dirty || !settings?.canDraft} onClick={() => void act("create")}>New announcement</button></div>
    <p className="subtle">Send an update to all registered users with valid email addresses. Each user receives a private email.</p>
    {settings && !settings.configured ? <p>Announcements need a database, official email sender, and monitored Reply-To inbox.</p> : null}
    {error ? <p role="alert" className="feedback-error">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {active ? <div className="announcement-editor" aria-busy={busy}>
      <h3>{editable ? "Announcement draft" : "Queued announcement"}</h3>
      <label htmlFor="announcement-subject">Subject<input id="announcement-subject" maxLength={200} disabled={!editable || busy} value={content.subject} onChange={event => { setContent({ ...content, subject: event.target.value }); setDirty(true); setAudience(null); }} /></label>
      <label htmlFor="announcement-body">Message<textarea id="announcement-body" rows={8} maxLength={10_000} disabled={!editable || busy} value={content.body} onChange={event => { setContent({ ...content, body: event.target.value }); setDirty(true); setAudience(null); }} /></label>
      <div className="announcement-link-fields">
        <label htmlFor="announcement-button-label">Button label (optional)<input id="announcement-button-label" maxLength={60} disabled={!editable || busy} value={content.buttonLabel} onChange={event => { setContent({ ...content, buttonLabel: event.target.value }); setDirty(true); setAudience(null); }} /></label>
        <label htmlFor="announcement-button-url">Button URL (HTTPS)<input id="announcement-button-url" type="url" disabled={!editable || busy} value={content.buttonUrl} onChange={event => { setContent({ ...content, buttonUrl: event.target.value }); setDirty(true); setAudience(null); }} /></label>
      </div>
      <p className="subtle">From: {settings?.from} · Reply-To: {settings?.replyTo}</p>
      <div className="announcement-actions">
        {editable ? <button className="secondary-button" disabled={busy || !valid || !dirty} onClick={() => void act("save")}>Save draft</button> : null}
        <button className="secondary-button" disabled={!valid} onClick={() => dialog.current?.showModal()}>Preview email</button>
        {editable ? <><button className="secondary-button" disabled={busy || dirty || !valid || !settings?.configured} onClick={() => void act("test")}>Send test to me</button>
          <button className="secondary-button" disabled={busy || dirty || !valid} onClick={() => void act("review")}>Review recipients</button></> : null}
      </div>
      {dirty ? <p className="subtle">Save your changes before testing or sending. Switch drafts after saving, or <button className="announcement-text-button" onClick={() => choose(active)}>discard changes</button>.</p> : null}
      {editable && audience ? <div className="announcement-confirm">
        <h4>Send to {audience.count} users?</h4>
        <p>This sends the saved message to all eligible registered users. Duplicate addresses and demo accounts are excluded. Once queued, the message cannot be edited or recalled.</p>
        <button className="primary-button" disabled={busy || dirty || audience.count === 0 || !settings?.configured} onClick={() => void act("send")}>Send announcement to {audience.count} users</button>
        <button className="secondary-button" disabled={busy} onClick={() => setAudience(null)}>Cancel</button>
      </div> : null}
    </div> : null}
    <dialog ref={dialog} className="feedback-email-preview" aria-labelledby="announcement-preview-heading">
      <div className="feedback-email-preview-header"><h3 id="announcement-preview-heading">Email preview</h3><button className="secondary-button" onClick={() => dialog.current?.close()}>Close preview</button></div>
      <p className="feedback-email-envelope">Subject: {content.subject}</p>
      <iframe title="Announcement email preview" sandbox="" srcDoc={valid ? announcementEmailHtml(content) : ""} />
    </dialog>
    <div className="section-title"><h3>Announcement history</h3><button className="secondary-button" disabled={busy} onClick={() => { void load().catch(error => setError(error.message)); }}>Refresh history</button></div>
    {!items.length ? <p className="subtle">{error ? "History could not be loaded." : settings ? "No announcements yet." : "Loading announcements…"}</p> : <ul className="announcement-history">{items.map(item => <li key={item.id}>
      <button className="secondary-button" disabled={busy || dirty} onClick={() => choose(item)}>{item.subject || "Untitled draft"}</button>
      <p className="subtle">{item.status === "draft" ? `Draft · ${item.author}` : `Queued by ${item.sender}`} · {new Date(item.queuedAt || item.createdAt).toLocaleString()}</p>
      {item.status === "queued" ? <>
        <p>{item.accepted} accepted by email provider · {item.pending} pending · {item.unconfirmed} unconfirmed · {item.blocked} need manual review · {item.total} recipients</p>
        <p className="subtle">Provider acceptance does not confirm inbox delivery.</p>
        {item.pending > 0 ? <p className="subtle">Sending continues in the background for up to four minutes per run. If progress stops, resume the remaining recipients below.</p> : null}
        {item.pending > 0 || item.unconfirmed > 0 ? <button className="secondary-button" disabled={busy} onClick={async () => {
          setBusy(true); setError(""); try {
            const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resume", id: item.id }) });
            if (!response.ok) throw new Error((await response.json()).error);
            setNotice("Processing resumed. Unconfirmed sends become eligible for retry after one minute.");
          } catch (error) { setError(error instanceof Error ? error.message : "Could not resume."); } finally { setBusy(false); }
        }}>Resume pending / retry unconfirmed</button> : null}
        {item.blocked > 0 ? <p role="status">Safe retries have expired for some recipients. Check this announcement in Resend before sending another message.</p> : null}
      </> : null}
    </li>)}</ul>}
  </AdminSection>;
}
