"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerDetail } from "@/lib/fantasy/types";
import { PlayerDetailView, type PlayerAction, type PlayerDetailStatusBanner } from "./player-detail-view";

type SheetState =
  | { kind: "loading"; player: PlayerDetail | null; message: string }
  | { kind: "success"; player: PlayerDetail; message: string }
  | { kind: "error"; player: PlayerDetail | null; message: string };

type PlayerDetailSheetProps = {
  playerId: string;
  teamId: string;
  onClose: () => void;
};

export function PlayerDetailSheet({ playerId, teamId, onClose }: PlayerDetailSheetProps) {
  const [state, setState] = useState<SheetState>({ kind: "loading", player: null, message: "Loading player..." });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading", player: null, message: "Loading player..." });

    (async () => {
      try {
        const response = await fetch(`/api/v1/players/${playerId}`);
        const result = (await response.json()) as { player?: PlayerDetail; error?: string };

        if (!active) {
          return;
        }

        if (!response.ok || !result.player) {
          setState({ kind: "error", player: null, message: result.error ?? "Player detail could not be loaded." });
          return;
        }

        setState({ kind: "success", player: result.player, message: "" });
      } catch {
        if (active) {
          setState({ kind: "error", player: null, message: "Player detail could not be loaded." });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [playerId]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function applyAction(action: PlayerAction) {
    const current = state.player;
    if (!current) {
      return;
    }

    setState({ kind: "loading", player: current, message: "Applying player action..." });

    try {
      const response = await fetch(`/api/v1/teams/${teamId}/players/${current.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as { player?: PlayerDetail; error?: string };

      if (!response.ok || !result.player) {
        setState({ kind: "error", player: current, message: result.error ?? "Player action could not be applied." });
        return;
      }

      setState({ kind: "success", player: result.player, message: "Player action applied." });
    } catch {
      setState({ kind: "error", player: current, message: "Player action could not be applied." });
    }
  }

  const player = state.player;
  const statusBanner: PlayerDetailStatusBanner | null =
    state.kind === "loading"
      ? { kind: "good", message: state.message }
      : state.kind === "error"
        ? { kind: "bad", message: state.message }
        : state.kind === "success" && state.message
          ? { kind: "good", message: state.message }
          : null;

  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div
        className="move-sheet player-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Player detail"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="move-sheet-grabber" aria-hidden="true" />
        <div className="detail-sheet-close-row">
          <button className="move-sheet-close" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        {player ? (
          <PlayerDetailView
            player={player}
            actionInFlight={state.kind === "loading"}
            statusBanner={statusBanner}
            onAction={applyAction}
            variant="card"
          />
        ) : (
          <div className={state.kind === "error" ? "status-banner bad" : "empty-state"}>{state.message}</div>
        )}
      </div>
    </div>
  );
}
