export type DraftCountdown = {
  complete: boolean;
  totalSeconds: number;
  label: string;
};

/** Deterministic countdown math shared by the UI and unit tests. */
export function draftCountdown(targetMs: number, nowMs: number): DraftCountdown {
  const totalSeconds = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));

  if (totalSeconds === 0) {
    return { complete: true, totalSeconds: 0, label: "Starting now…" };
  }

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;

  return {
    complete: false,
    totalSeconds,
    label: days > 0 ? `${days}d ${clock}` : clock,
  };
}
