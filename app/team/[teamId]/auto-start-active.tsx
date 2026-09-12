"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function StartActiveHelp() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="start-active-help" type="button" aria-label="About Start Active Players" onClick={() => dialog.current?.showModal()}>?</button>
    <dialog ref={dialog} className="start-active-dialog" aria-labelledby="start-active-help-title" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <h2 id="start-active-help-title" tabIndex={-1} autoFocus>Start Active Players</h2>
      <p>Sets and saves the selected day’s lineup using players already on your roster. It fills eligible starting slots and benches the remaining players, respecting your league’s roster limits and game locks. Players on IL or NA stay there.</p>
      <p>Hitters with a game who are in the MLB lineup, or whose lineup has not been posted yet, take priority over hitters sitting out. Pitchers prioritize today’s probable starters, then relief-eligible pitchers, then other starting pitchers.</p>
      <p>Within those priorities, the process uses expected fantasy points for the day, then rest-of-season projected points, lower ADP, and player name to break ties. It can rearrange eligible positions to fit more players and may fill spare slots with players who are not playing that day. It uses points projections even in category leagues.</p>
      <p><strong>Auto-start active</strong> runs this same process for this team’s current-day lineup during each nightly update while the league is active or in playoffs. Turn it off to stop future automatic runs. Enabling it schedules future runs; use Start Active Players to set a lineup now.</p>
      <p>Overnight MLB lineups may not be posted yet. Auto-start does not continuously react to scratches or later lineup announcements. Review your lineup before games; unlocked manual changes can be replaced by the next nightly run.</p>
      <form method="dialog"><button type="submit" className="start-active-button">Got it</button></form>
    </dialog>
  </>;
}

export function AutoStartActive({ teamId, initialEnabled, canManage }: { teamId: string; initialEnabled: boolean; canManage: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/teams/${teamId}/auto-start-active`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save auto-start.");
      setEnabled(result.enabled);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save auto-start. Please try again.");
    } finally { setSaving(false); }
  }
  return <div className="auto-start-setting">
    <div className="auto-start-row">
      <span role="status">{enabled ? "Auto-start active is ON · Runs nightly" : "Auto-start active is OFF"}</span>
      {canManage ? <button type="button" className="start-active-button" role="switch" aria-checked={enabled} aria-label="Auto-start active" disabled={saving} onClick={toggle}>{saving ? "Saving…" : enabled ? "Turn off auto-start" : "Enable auto-start"}</button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
