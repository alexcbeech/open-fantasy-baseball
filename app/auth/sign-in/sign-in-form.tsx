"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInWithEmail, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function SignInForm({ signupsEnabled, next }: { signupsEnabled: boolean; next?: string }) {
  const [state, formAction, pending] = useActionState(signInWithEmail, initialState);

  return (
    <form action={formAction} className="auth-form">
      {state?.error ? <div className="status-banner bad">{state.error}</div> : null}
      {next ? <input name="next" type="hidden" value={next} /> : null}
      <label className="field">
        Email
        <input autoComplete="email" autoFocus name="email" required type="email" />
      </label>
      <label className="field">
        Password
        <input autoComplete="current-password" name="password" required type="password" />
      </label>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Signing in..." : "Sign in"}
      </button>
      {signupsEnabled ? (
        <p className="auth-alt">
          New to OFB? <Link href="/auth/sign-up">Create an account</Link>
        </p>
      ) : null}
    </form>
  );
}
