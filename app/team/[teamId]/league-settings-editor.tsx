"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeagueSettings } from "@/lib/fantasy/types";

type LeagueSettingsEditorProps = {
  leagueId: string;
  settings: LeagueSettings;
};

/**
 * Commissioner-only editor for the settings that stay changeable after a
 * league exists (waivers, trade review, lineup locks, IL+/NA). Structural
 * settings — scoring, teams, roster shape, draft — are fixed at creation.
 */
export function LeagueSettingsEditor({ leagueId, settings }: LeagueSettingsEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    waiverMode: settings.waiverMode,
    faabBudget: String(settings.faabBudget),
    tradeReview: settings.tradeReview,
    tradeReviewDays: String(settings.tradeReviewDays),
    lineupLockMode: settings.lineupLockMode,
    allowILPlus: settings.allowILPlus,
    allowNA: settings.allowNA,
  });

  async function save() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/v1/leagues/${leagueId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          waiverMode: form.waiverMode,
          faabBudget: Number.parseInt(form.faabBudget, 10) || 0,
          tradeReview: form.tradeReview,
          tradeReviewDays: Number.parseInt(form.tradeReviewDays, 10) || 0,
          lineupLockMode: form.lineupLockMode,
          allowILPlus: form.allowILPlus,
          allowNA: form.allowNA,
        }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(result.error ?? "Settings could not be saved.");
        return;
      }

      setMessage("Settings saved.");
      router.refresh();
    } catch {
      setMessage("Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
        Edit League Settings
      </button>
    );
  }

  return (
    <div className="settings-editor">
      {message ? <div className="status-banner">{message}</div> : null}

      <label className="settings-field">
        Waivers
        <select value={form.waiverMode} onChange={(e) => setForm({ ...form, waiverMode: e.target.value as typeof form.waiverMode })}>
          <option value="rolling">Rolling priority</option>
          <option value="faab">FAAB (bid budget)</option>
        </select>
      </label>
      {form.waiverMode === "faab" ? (
        <label className="settings-field">
          FAAB budget
          <input type="number" min={0} max={1000} value={form.faabBudget} onChange={(e) => setForm({ ...form, faabBudget: e.target.value })} />
        </label>
      ) : null}
      <label className="settings-field">
        Trade review
        <select value={form.tradeReview} onChange={(e) => setForm({ ...form, tradeReview: e.target.value as typeof form.tradeReview })}>
          <option value="league-vote">League vote</option>
          <option value="commissioner">Commissioner review</option>
          <option value="none">No review</option>
        </select>
      </label>
      <label className="settings-field">
        Review days
        <input
          type="number"
          min={0}
          max={7}
          value={form.tradeReviewDays}
          onChange={(e) => setForm({ ...form, tradeReviewDays: e.target.value })}
        />
      </label>
      <label className="settings-field">
        Lineup locks
        <select
          value={form.lineupLockMode}
          onChange={(e) => setForm({ ...form, lineupLockMode: e.target.value as typeof form.lineupLockMode })}
        >
          <option value="daily">Daily (per player)</option>
          <option value="first-game">At the day&apos;s first game</option>
        </select>
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={form.allowILPlus} onChange={(e) => setForm({ ...form, allowILPlus: e.target.checked })} />
        IL+ (day-to-day players may use IL slots)
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={form.allowNA} onChange={(e) => setForm({ ...form, allowNA: e.target.checked })} />
        NA slots for minor leaguers
      </label>

      <div className="confirm-panel-actions">
        <button className="primary-button" type="button" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save Settings"}
        </button>
        <button className="secondary-button" type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
