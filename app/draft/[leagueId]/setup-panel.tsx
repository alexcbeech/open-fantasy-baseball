"use client";

import { useState } from "react";
import { draftPickSecondsOptions } from "@/lib/fantasy/settings-matrix";
import type { DraftLobby } from "@/lib/data/draft";
import type { DraftState } from "@/lib/draft/types";

type SetupPanelProps = {
  lobby: DraftLobby;
  draft: DraftState | null;
  onDraftChange: (draft: DraftState) => void;
};

/**
 * Commissioner draft setup: name your team, pick the clock, fill open seats
 * with bots, randomize or nudge the order, then start the draft.
 */
/** ISO timestamp → the local-time value a datetime-local input expects. */
function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SetupPanel({ lobby, draft, onDraftChange }: SetupPanelProps) {
  const [teamName, setTeamName] = useState(lobby.myTeamName ?? "");
  const [pickSeconds, setPickSeconds] = useState(draft?.pickSeconds ?? lobby.defaultPickSeconds);
  const [fillWithBots, setFillWithBots] = useState(true);
  const [scheduledStart, setScheduledStart] = useState(
    draft?.scheduledStartAt ? toDatetimeLocalValue(draft.scheduledStartAt) : "",
  );
  const [order, setOrder] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "good"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const teams = draft?.teams ?? [];
  const orderedTeams = order
    ? order.map((teamId) => teams.find((team) => team.teamId === teamId)!).filter(Boolean)
    : teams;
  const openSeats = Math.max(0, lobby.teamCount - teams.length);

  async function postSetup(explicitOrder?: string[], randomize = false) {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pickSeconds,
          randomizeOrder: randomize,
          order: explicitOrder,
          // A scheduled draft keeps its seats open until start time, when
          // bots fill whatever is still empty.
          fillWithBots: scheduledStart ? false : fillWithBots,
          myTeamName: teamName,
          scheduledStartAt: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        }),
      });
      const result = (await response.json()) as { error?: string; draft?: DraftState };

      if (!response.ok || !result.draft) {
        setMessage({ kind: "error", text: result.error ?? "Draft setup failed." });
        return;
      }

      setOrder(null);
      onDraftChange(result.draft);
      setMessage({ kind: "good", text: "Draft is set up. Review the order, then start." });
    } catch {
      setMessage({ kind: "error", text: "Draft setup could not be saved." });
    } finally {
      setBusy(false);
    }
  }

  async function startDraft() {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/v1/leagues/${lobby.leagueId}/draft/start`, { method: "POST" });
      const result = (await response.json()) as { error?: string; draft?: DraftState };

      if (!response.ok || !result.draft) {
        setMessage({ kind: "error", text: result.error ?? "The draft could not be started." });
        return;
      }

      onDraftChange(result.draft);
    } catch {
      setMessage({ kind: "error", text: "The draft could not be started." });
    } finally {
      setBusy(false);
    }
  }

  function moveTeam(index: number, delta: number) {
    const current = orderedTeams.map((team) => team.teamId);
    const target = index + delta;

    if (target < 0 || target >= current.length) {
      return;
    }

    [current[index], current[target]] = [current[target], current[index]];
    setOrder(current);
  }

  return (
    <section className="panel" aria-labelledby="draft-setup-heading">
      <h2 id="draft-setup-heading">Draft Setup</h2>
      {message ? <div className={message.kind === "error" ? "status-banner bad" : "status-banner good"}>{message.text}</div> : null}

      <label className="field">
        <span>Your Team Name</span>
        <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. Golden Sombreros" />
      </label>

      <div className="field-grid">
        <label className="field">
          <span>Pick Clock</span>
          <select value={pickSeconds} onChange={(event) => setPickSeconds(Number(event.target.value))}>
            {draftPickSecondsOptions.map((seconds) => (
              <option value={seconds} key={seconds}>
                {seconds}s
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Scheduled Start (optional)</span>
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(event) => setScheduledStart(event.target.value)}
          />
        </label>
      </div>

      {scheduledStart ? (
        <p className="subtle">
          The draft starts automatically at the scheduled time. Seats stay open for managers until then; any still
          empty are filled with bots at start. League members are notified when you save the schedule and again
          shortly before the draft.
        </p>
      ) : (
        <label className="check-row draft-setup-bots">
          <input type="checkbox" checked={fillWithBots} onChange={(event) => setFillWithBots(event.target.checked)} />
          <span>Fill open seats with bots</span>
        </label>
      )}

      <div className="draft-setup-actions">
        <button className="primary-button" type="button" disabled={busy || teamName.trim().length < 3} onClick={() => postSetup()}>
          {draft ? "Update Setup" : "Create Seats"}
        </button>
        {draft ? (
          <button className="secondary-button" type="button" disabled={busy} onClick={() => postSetup(undefined, true)}>
            Randomize Order
          </button>
        ) : null}
      </div>

      {draft ? (
        <>
          <h3>Draft Order</h3>
          <div className="draft-order-list">
            {orderedTeams.map((team, index) => (
              <div className="draft-order-row" key={team.teamId}>
                <span className="draft-order-position">{index + 1}</span>
                <span className="player-main">
                  <span className="player-name">{team.name}</span>
                  <span className="player-meta">{team.isBot ? "Bot" : team.managerName}</span>
                </span>
                <span className="draft-order-controls">
                  <button type="button" aria-label={`Move ${team.name} up`} disabled={index === 0} onClick={() => moveTeam(index, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${team.name} down`}
                    disabled={index === orderedTeams.length - 1}
                    onClick={() => moveTeam(index, 1)}
                  >
                    ↓
                  </button>
                </span>
              </div>
            ))}
          </div>
          {order ? (
            <button className="secondary-button" type="button" disabled={busy} onClick={() => postSetup(order)}>
              Save Order
            </button>
          ) : null}

          <button className="primary-button draft-start-button" type="button" disabled={busy} onClick={startDraft}>
            {openSeats === 0
              ? "Start Draft"
              : `Start Draft Now (fills ${openSeats} open seat${openSeats === 1 ? "" : "s"} with bots)`}
          </button>
          {draft?.scheduledStartAt ? (
            <p className="subtle">
              Scheduled to start {new Date(draft.scheduledStartAt).toLocaleString()}
              {openSeats > 0 ? `; ${openSeats} open seat${openSeats === 1 ? "" : "s"} will be filled with bots.` : "."}
            </p>
          ) : null}
        </>
      ) : (
        <p className="subtle">
          Creating seats adds your team{fillWithBots ? " and fills the rest of the league with bots" : ""}. The league drafts{" "}
          {lobby.teamCount} teams.
        </p>
      )}
    </section>
  );
}
