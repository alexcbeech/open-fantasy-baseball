"use client";

import { useState } from "react";
import type { defaultCreateLeagueInput } from "@/lib/fantasy/league-create";
import { draftTypes, lineupLockModes, tradeReviewModes, waiverModes } from "@/lib/fantasy/settings-matrix";

type LeagueCreateFormProps = {
  defaults: typeof defaultCreateLeagueInput;
};

type SubmitState =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function LeagueCreateForm({ defaults }: LeagueCreateFormProps) {
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLeague(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitState({ kind: "idle", message: "Creating league..." });

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: formData.get("name"),
      seasonYear: formData.get("seasonYear"),
      scoringType: formData.get("scoringType"),
      teamCount: formData.get("teamCount"),
      waiverMode: formData.get("waiverMode"),
      faabBudget: formData.get("faabBudget"),
      tradeReview: formData.get("tradeReview"),
      tradeReviewDays: formData.get("tradeReviewDays"),
      lineupLockMode: formData.get("lineupLockMode"),
      draftType: formData.get("draftType"),
      allowNA: formData.has("allowNA"),
      allowILPlus: formData.has("allowILPlus"),
    };

    try {
      const response = await fetch("/api/v1/leagues", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; league?: { settings?: { name?: string } } };

      if (!response.ok) {
        setSubmitState({ kind: "error", message: result.error ?? "League settings need changes." });
        return;
      }

      setSubmitState({
        kind: "success",
        message: `${result.league?.settings?.name ?? "League"} is ready to persist once database access is wired.`,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="panel form-panel" onSubmit={submitLeague}>
      <h1>League Setup</h1>
      {submitState.message ? (
        <div className={submitState.kind === "error" ? "status-banner bad" : "status-banner good"}>{submitState.message}</div>
      ) : null}
      <label className="field">
        <span>League Name</span>
        <input name="name" defaultValue={defaults.name} />
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Season</span>
          <input name="seasonYear" inputMode="numeric" defaultValue={defaults.seasonYear} />
        </label>
        <label className="field">
          <span>Teams</span>
          <input name="teamCount" inputMode="numeric" defaultValue={defaults.teamCount} />
        </label>
      </div>

      <label className="field">
        <span>Scoring</span>
        <select name="scoringType" defaultValue={defaults.scoringType}>
          <option value="h2h-categories">H2H Categories</option>
          <option value="h2h-points">H2H Points</option>
          <option value="roto">Rotisserie</option>
        </select>
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Waivers</span>
          <select name="waiverMode" defaultValue={defaults.waiverMode}>
            {waiverModes.map((mode) => (
              <option value={mode} key={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>FAAB</span>
          <input name="faabBudget" inputMode="numeric" defaultValue={defaults.faabBudget} />
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Trade Review</span>
          <select name="tradeReview" defaultValue={defaults.tradeReview}>
            {tradeReviewModes.map((mode) => (
              <option value={mode} key={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Review Days</span>
          <input name="tradeReviewDays" inputMode="numeric" defaultValue={defaults.tradeReviewDays} />
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Lineups</span>
          <select name="lineupLockMode" defaultValue={defaults.lineupLockMode}>
            {lineupLockModes.map((mode) => (
              <option value={mode} key={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Draft</span>
          <select name="draftType" defaultValue={defaults.draftType}>
            {draftTypes.map((draftType) => (
              <option value={draftType} key={draftType}>
                {draftType}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="check-row">
        <input name="allowNA" type="checkbox" defaultChecked={defaults.allowNA} />
        <span>Enable NA slots</span>
      </label>
      <label className="check-row">
        <input name="allowILPlus" type="checkbox" defaultChecked={defaults.allowILPlus} />
        <span>Enable IL+ eligibility</span>
      </label>

      <button className="primary-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating..." : "Create League"}
      </button>
    </form>
  );
}
