"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteLeagueButtonProps = {
  leagueId: string;
  leagueName: string;
};

export function DeleteLeagueButton({ leagueId, leagueName }: DeleteLeagueButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeLeague() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/leagues/${leagueId}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "The league could not be deleted.");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("The league could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button className="danger-button league-delete-trigger" type="button" onClick={() => setConfirming(true)}>
        Delete League
      </button>
    );
  }

  return (
    <div className="confirm-panel league-delete-confirm" role="alert">
      <h4>Delete {leagueName}?</h4>
      <p>This permanently deletes every team, roster, matchup, transaction, invite, and draft record in this league.</p>
      {error ? <div className="status-banner bad">{error}</div> : null}
      <div className="confirm-panel-actions">
        <button className="danger-button" type="button" disabled={busy} aria-busy={busy} onClick={removeLeague}>
          {busy ? "Deleting..." : "Yes, Delete League"}
        </button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
