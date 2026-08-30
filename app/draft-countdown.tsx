"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { draftCountdown, type DraftCountdown as DraftCountdownValue } from "@/lib/draft/countdown";

export function DraftCountdown({ scheduledStartAt }: { scheduledStartAt: string }) {
  const router = useRouter();
  const refreshed = useRef(false);
  const [countdown, setCountdown] = useState<DraftCountdownValue | null>(null);

  useEffect(() => {
    const targetMs = Date.parse(scheduledStartAt);

    if (Number.isNaN(targetMs)) {
      const resetTimer = window.setTimeout(() => setCountdown(null), 0);
      return () => window.clearTimeout(resetTimer);
    }

    const update = () => {
      const next = draftCountdown(targetMs, Date.now());
      setCountdown(next);

      if (next.complete && !refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
    };

    refreshed.current = false;
    const initialTimer = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [scheduledStartAt, router]);

  if (!countdown) {
    return <div className="draft-countdown draft-countdown-loading">Calculating countdown…</div>;
  }

  return (
    <div className={countdown.complete ? "draft-countdown is-complete" : "draft-countdown"}>
      <span>{countdown.complete ? "Draft" : "Draft starts in"}</span>
      <time dateTime={scheduledStartAt}>{countdown.label}</time>
    </div>
  );
}
