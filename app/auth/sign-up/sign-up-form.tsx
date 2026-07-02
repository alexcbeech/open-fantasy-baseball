"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpWithEmail, type AuthFormState } from "./actions";

const initialState: AuthFormState = null;

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUpWithEmail, initialState);

  return (
    <form action={formAction} className="auth-form">
      {state?.error ? <div className="status-banner bad">{state.error}</div> : null}
      <label className="field">
        Name
        <input autoComplete="name" name="name" required type="text" />
      </label>
      <label className="field">
        Email
        <input autoComplete="email" name="email" required type="email" />
      </label>
      <label className="field">
        Password
        <input autoComplete="new-password" minLength={8} name="password" required type="password" />
      </label>
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? "Creating..." : "Create account"}
      </button>
      <Link className="secondary-button" href="/auth/sign-in">
        Sign in instead
      </Link>
    </form>
  );
}
