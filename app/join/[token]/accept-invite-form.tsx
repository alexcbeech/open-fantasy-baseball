"use client";

import { useActionState } from "react";
import { acceptInvite, type AcceptInviteState } from "./actions";

const initialState: AcceptInviteState = null;

export function AcceptInviteForm({ token, leagueName }: { token: string; leagueName: string }) {
  const [state, formAction, pending] = useActionState(acceptInvite, initialState);

  return (
    <form action={formAction} className="auth-form">
      {state?.error ? <div className="status-banner bad">{state.error}</div> : null}
      <input name="token" type="hidden" value={token} />
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Joining..." : `Join ${leagueName}`}
      </button>
    </form>
  );
}
