"use client";

import { AdminSection } from "./admin-section";

import { useCallback, useEffect, useState } from "react";
import type { AccountCommand, AdminUser } from "@/lib/data/admin-user-schema";

export function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [configured, setConfigured] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<{ user: AdminUser; action: AccountCommand["action"] } | null>(null);
  const [reason, setReason] = useState("");

  const reload = useCallback(async () => {
    const response = await fetch(`/api/v1/admin/users?search=${encodeURIComponent(filter)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Users could not be loaded.");
    setUsers(data.users); setCurrentUserId(data.currentUserId); setConfigured(data.configured);
  }, [filter]);
  useEffect(() => {
    let canceled = false;
    fetch(`/api/v1/admin/users?search=${encodeURIComponent(filter)}`, { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Users could not be loaded."); return data; })
      .then(data => { if (!canceled) { setUsers(data.users); setCurrentUserId(data.currentUserId); setConfigured(data.configured); } })
      .catch(error => { if (!canceled) setError(error.message); });
    return () => { canceled = true; };
  }, [filter]);

  async function submit() {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/admin/users", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.user.id, revision: selected.user.revision, action: selected.action, reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Account change failed.");
      setNotice(data.authSyncPending ? "Account deactivated. App access and notifications are blocked. Authentication sync needs a retry."
        : selected.action === "reactivate" ? "Account reactivated. A fresh sign-in is required; old tokens and canceled notifications stay disabled."
          : selected.action === "retry-auth" ? "Authentication synchronized. The account remains deactivated." : "Account deactivated. Access and notifications are blocked.");
      setSelected(null); setReason("");
      await reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Account change failed.");
      await reload().catch(() => undefined);
      setSelected(null);
    } finally { setBusy(false); }
  }

  return <AdminSection title="Users" id="admin-users-heading" className="admin-users-panel">
    <div className="section-title">
      <button className="secondary-button" disabled={busy} onClick={() => { setError(""); reload().catch(error => setError(error.message)); }}>Reload users</button></div>
    <p className="subtle">Deactivate an account to stop sign-in, account access, emails, and push notifications. Teams and league history are preserved.</p>
    <form className="admin-user-search" onSubmit={event => { event.preventDefault(); setFilter(search.trim()); setSelected(null); }}>
      <label>Find users<input value={search} maxLength={200} onChange={event => setSearch(event.target.value)} placeholder="Name or email" /></label>
      <button className="secondary-button" disabled={busy}>Search users</button>
    </form>
    {!configured ? <p className="status-banner">Connect a database to manage accounts.</p> : null}
    {error ? <p className="status-banner bad" role="alert">{error}</p> : null}
    {notice ? <p className="status-banner" role="status">{notice}</p> : null}
    <div className="admin-user-list">{users.map(user => <article className="admin-user-card" key={user.id}>
      <div><strong>{user.displayName}</strong><div className="subtle">{user.email}</div></div>
      <strong>{user.deactivatedAt ? "Deactivated" : "Active"}{user.id === currentUserId ? " · You" : ""}</strong>
      {user.deactivatedAt ? <p className="subtle">Deactivated {new Date(user.deactivatedAt).toLocaleString()}{user.deactivatedBy ? ` by ${user.deactivatedBy}` : ""}{user.reason ? ` — ${user.reason}` : ""}</p> : null}
      {user.authSyncPending ? <p className="status-banner bad">App access is blocked. Authentication sync is pending.</p> : null}
      <div className="admin-user-actions">
        <button className="secondary-button" disabled={busy || user.id === currentUserId} onClick={() => { setSelected({ user, action: user.deactivatedAt ? "reactivate" : "deactivate" }); setReason(""); setError(""); setNotice(""); }}>
          {user.deactivatedAt ? "Reactivate" : "Deactivate"}
        </button>
        {user.authSyncPending ? <button className="secondary-button" disabled={busy} onClick={() => { setSelected({ user, action: "retry-auth" }); setReason(""); }}>Retry authentication sync</button> : null}
      </div>
      {user.id === currentUserId ? <p className="subtle">You cannot deactivate yourself. This keeps an administrator available.</p> : null}
      {selected?.user.id === user.id ? <div className="admin-user-confirm" role="group" aria-label="Confirm account change">
        <h3>{selected.action === "deactivate" ? "Deactivate" : selected.action === "reactivate" ? "Reactivate" : "Retry authentication sync for"} {user.displayName}?</h3>
        <p>{selected.action === "deactivate" ? "This blocks existing sessions and API tokens, stops emails and push notifications, and cancels queued notifications. Messages already handed to a provider may still arrive. Team ownership stays in place."
          : selected.action === "reactivate" ? "The user can sign in again. Old sessions, API tokens, and canceled notifications will not be restored." : "Retry the provider block and session revocation. App access remains blocked."}</p>
        {selected.action === "deactivate" ? <label>Reason (optional)<textarea value={reason} maxLength={1000} rows={3} disabled={busy} onChange={event => setReason(event.target.value)} /></label> : null}
        <div className="admin-user-actions"><button className="primary-button" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Confirm account change"}</button>
          <button className="secondary-button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div>
      </div> : null}
    </article>)}</div>
    {configured && !error && !users.length ? <p className="subtle">No users found.</p> : null}
    {users.length === 100 ? <p className="subtle">Showing the first 100 matches. Search to narrow the list.</p> : null}
  </AdminSection>;
}
