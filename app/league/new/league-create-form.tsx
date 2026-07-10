"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { defaultCreateLeagueInput } from "@/lib/fantasy/league-create";
import { draftPickSecondsOptions, draftTypes, lineupLockModes, playerPools, tradeReviewModes, waiverModes } from "@/lib/fantasy/settings-matrix";
import type { WaiverMode } from "@/lib/fantasy/types";

// Human-friendly labels for every dropdown value; raw setting keys like
// "faab" or "league-vote" never render directly.
const waiverModeLabels: Record<string, string> = {
  rolling: "Rolling Waivers",
  faab: "FAAB (Bid Budget)",
};

const tradeReviewLabels: Record<string, string> = {
  "league-vote": "League Vote",
  commissioner: "Commissioner Review",
  none: "No Review",
};

const lineupLockLabels: Record<string, string> = {
  daily: "Daily",
  "first-game": "Lock At First Game",
};

const draftTypeLabels: Record<string, string> = {
  snake: "Snake",
  // "offline" runs a live draft with the same order every round (no snake).
  offline: "Linear (same order each round)",
};

const playerPoolLabels: Record<string, string> = {
  all: "All MLB",
  al: "AL Only",
  nl: "NL Only",
  "al-east": "AL East Only",
  "al-central": "AL Central Only",
  "al-west": "AL West Only",
  "nl-east": "NL East Only",
  "nl-central": "NL Central Only",
  "nl-west": "NL West Only",
};

type LeagueCreateFormProps = {
  defaults: typeof defaultCreateLeagueInput;
};

type SubmitState =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function LeagueCreateForm({ defaults }: LeagueCreateFormProps) {
  const router = useRouter();
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [waiverMode, setWaiverMode] = useState<WaiverMode>(defaults.waiverMode);

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
      // Rolling waivers have no bid budget; the field is hidden, so submit the
      // default rather than a stale value from a briefly-selected FAAB mode.
      faabBudget: formData.get("faabBudget") ?? defaults.faabBudget,
      tradeReview: formData.get("tradeReview"),
      tradeReviewDays: formData.get("tradeReviewDays"),
      lineupLockMode: formData.get("lineupLockMode"),
      draftType: formData.get("draftType"),
      playerPool: formData.get("playerPool"),
      draftPickSeconds: formData.get("draftPickSeconds"),
      benchSlots: formData.get("benchSlots"),
      ilSlots: formData.get("ilSlots"),
      playoffTeamCount: formData.get("playoffTeamCount"),
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
      const result = (await response.json()) as {
        error?: string;
        league?: { id?: string; settings?: { name?: string } };
      };

      if (!response.ok) {
        setSubmitState({ kind: "error", message: result.error ?? "League settings need changes." });
        return;
      }

      const leagueId = result.league?.id;
      const leagueName = result.league?.settings?.name ?? "League";

      if (!leagueId || leagueId === "pending-persistence") {
        // Demo mode (no database): the settings validated but nothing was saved.
        setSubmitState({
          kind: "success",
          message: `${leagueName} validated. Connect a database to save leagues in demo mode.`,
        });
        return;
      }

      setSubmitState({ kind: "success", message: `${leagueName} created! Heading to your draft room...` });
      router.push(`/draft/${leagueId}`);
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
          <select name="waiverMode" value={waiverMode} onChange={(event) => setWaiverMode(event.target.value as WaiverMode)}>
            {waiverModes.map((mode) => (
              <option value={mode} key={mode}>
                {waiverModeLabels[mode] ?? mode}
              </option>
            ))}
          </select>
        </label>
        {waiverMode === "faab" ? (
          <label className="field">
            <span>FAAB Budget ($)</span>
            <input name="faabBudget" inputMode="numeric" defaultValue={defaults.faabBudget} />
          </label>
        ) : null}
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Trade Review</span>
          <select name="tradeReview" defaultValue={defaults.tradeReview}>
            {tradeReviewModes.map((mode) => (
              <option value={mode} key={mode}>
                {tradeReviewLabels[mode] ?? mode}
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
                {lineupLockLabels[mode] ?? mode}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Draft</span>
          <select name="draftType" defaultValue={defaults.draftType}>
            {draftTypes.map((draftType) => (
              <option value={draftType} key={draftType}>
                {draftTypeLabels[draftType] ?? draftType}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Player Pool</span>
          <select name="playerPool" defaultValue={defaults.playerPool}>
            {playerPools.map((pool) => (
              <option value={pool} key={pool}>
                {playerPoolLabels[pool] ?? pool}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Pick Clock</span>
          <select name="draftPickSeconds" defaultValue={defaults.draftPickSeconds}>
            {draftPickSecondsOptions.map((seconds) => (
              <option value={seconds} key={seconds}>
                {seconds} seconds
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Bench Slots</span>
          <input name="benchSlots" inputMode="numeric" defaultValue={defaults.benchSlots} />
        </label>
        <label className="field">
          <span>IL Slots</span>
          <input name="ilSlots" inputMode="numeric" defaultValue={defaults.ilSlots} />
        </label>
      </div>

      <label className="field">
        <span>Playoff Teams</span>
        <input name="playoffTeamCount" inputMode="numeric" defaultValue={defaults.playoffTeamCount} />
      </label>

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
