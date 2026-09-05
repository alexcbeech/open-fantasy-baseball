"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Navigate as soon as a valid date or dropdown value is selected. */
export function AutoNavigateForm({ action, children }: { action: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form className="matchup-period-controls" action={action} aria-busy={pending}
    onChange={(event) => {
      if (event.currentTarget.checkValidity()) event.currentTarget.requestSubmit();
    }}
    onSubmit={(event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) {
        if (typeof value === "string") params.set(key, value);
      }
      startTransition(() => router.push(`${action}?${params}`));
    }}>
    {children}
  </form>;
}
