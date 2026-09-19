"use client";

import { useEffect, useState } from "react";
import type { BotManagerView } from "@/lib/ai-bots/schema";

type Decision = { id: string; name: string; model: string; reason: string; status: string; kind: string; created_at: string };
export function BotManagers({ leagueId, canManage }: { leagueId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [managers, setManagers] = useState<BotManagerView[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const url = `/api/v1/leagues/${leagueId}/bot-managers`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load AI managers.");
      setManagers(data.managers); setDecisions(data.decisions); setMessage("");
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, url, revision]);

  return <section className="panel ai-bot-panel">
    <div className="panel-header"><h2>AI managers</h2><button className="secondary-button" aria-expanded={open} onClick={() => { setLoading(true); setOpen(!open); }}>{open ? "Hide AI managers" : "View AI managers"}</button></div>
    <p>Compete against bots managed by different AI models. Each bot has its own strategy and connection.</p>
    {open && <>
      {message && <p role="alert">{message}</p>}
      {saved && <p role="status">AI manager saved.</p>}
      {loading && <p role="status">Loading AI managers…</p>}
      {!loading && !message && !managers.length && <p>No bot teams in this league yet.</p>}
      {managers.map((manager) => <BotManagerCard key={`${manager.teamId}:${manager.model}:${manager.strategy}:${manager.enabled}:${manager.allowTrades}`} manager={manager} canManage={canManage} url={url} onSaved={() => { setSaved(true); setRevision((v) => v + 1); }} />)}
      {!!decisions.length && <><h3>Recent AI decisions</h3><ul className="ai-bot-decisions">{decisions.map((decision) => <li key={decision.id}>
        <strong>{decision.name} · {decision.model || "Model not selected"}</strong>
        <p>{decision.reason}</p><small>{decision.kind} · {decision.status} · <time dateTime={decision.created_at}>{new Date(decision.created_at).toLocaleString()}</time></small>
      </li>)}</ul></>}
    </>}
  </section>;
}

function BotManagerCard({ manager, canManage, url, onSaved }: { manager: BotManagerView; canManage: boolean; url: string; onSaved: () => void }) {
  const [model, setModel] = useState(manager.model);
  const [strategy, setStrategy] = useState(manager.strategy);
  const [enabled, setEnabled] = useState(manager.enabled);
  const [allowTrades, setAllowTrades] = useState(manager.allowTrades);
  const [token, setToken] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(manager.hasToken);
  const [active, setActive] = useState(manager.enabled && manager.hasToken);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save(action?: "rotate-token" | "revoke-token") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(action ? { action, teamId: manager.teamId } : { teamId: manager.teamId, model, strategy, enabled, allowTrades }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save bot settings.");
      if (action) {
        setToken(data.token); setEnabled(false); setActive(false); setHasToken(Boolean(data.token));
        setMessage(action === "revoke-token" ? "Connection revoked. AI management is paused." : "Token created. Copy it now; it is shown only once. AI management is paused.");
      } else { onSaved(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save bot settings."); }
    finally { setBusy(false); }
  }
  return <article className="ai-bot-card">
    <h3>{manager.name}</h3>
    <p>{manager.model || "Model not selected"} · {active ? "AI management enabled" : "AI management paused"}</p>
    {canManage && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="settings-field">Model<input value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} placeholder="Choose later" /></label>
      <small>Use the same model in your scheduled task. This label does not select or verify the model running it.</small>
      <label className="settings-field">Management strategy<textarea value={strategy} onChange={(event) => setStrategy(event.target.value)} maxLength={4000} rows={4} placeholder="Protect valuable injured players, use IL and NA, and prioritize this week's matchup." /></label>
      <label className="ai-bot-toggle"><input type="checkbox" checked={allowTrades} onChange={(event) => setAllowTrades(event.target.checked)} />Allow trade proposals</label>
      <label className="ai-bot-toggle"><input type="checkbox" checked={enabled} disabled={!hasToken || !model.trim()} onChange={(event) => setEnabled(event.target.checked)} />Enable AI management</label>
      <small>When paused or the token expires, the standard bot lineup job resumes. Enabling AI management does not create a scheduled task.</small>
      <div className="ai-bot-actions"><button className="primary-button" disabled={busy}>Save AI manager</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => void save("rotate-token")}>{hasToken ? "Replace connection token" : "Create connection token"}</button>
        {hasToken && <button className="secondary-button" type="button" disabled={busy} onClick={() => void save("revoke-token")}>Revoke connection</button>}
      </div>
      {message && <p role="status">{message}</p>}
      {token && <div className="ai-bot-token"><label className="settings-field">Connection token<textarea readOnly rows={3} value={token} /></label>
        <p>Expires in 90 days. Store it as a secret in your MCP client. Endpoint: <code>/api/mcp/bot</code></p>
        <button className="secondary-button" type="button" onClick={() => setToken(null)}>Hide token</button></div>}
    </form>}
  </article>;
}
