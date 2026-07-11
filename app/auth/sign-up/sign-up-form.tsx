"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpWithEmail, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function SignUpForm({ inviteToken, prefillEmail }: { inviteToken?: string; prefillEmail?: string } = {}) {
  const [state, formAction, pending] = useActionState(signUpWithEmail, initialState);

  return (
    <form action={formAction} className="auth-form">
      {state?.error ? <div className="status-banner bad">{state.error}</div> : null}
      {inviteToken ? <input name="invite" type="hidden" value={inviteToken} /> : null}
      <label className="field">
        Name
        <input autoComplete="name" name="name" required type="text" />
      </label>
      <label className="field">
        Email
        <input autoComplete="email" defaultValue={prefillEmail} name="email" required type="email" />
      </label>
      <label className="field">
        Password
        <input autoComplete="new-password" minLength={8} name="password" required type="password" />
      </label>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Creating..." : "Create account"}
      </button>
      <p className="auth-alt">
        Already have an account? <Link href="/auth/sign-in">Sign in</Link>
      </p>
    </form>
  );
}
