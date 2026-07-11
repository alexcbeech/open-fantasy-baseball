"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";

type LeagueInviteButtonProps = {
  leagueId: string;
};

type InviteSuccess = {
  email: string;
  emailSent: boolean;
  joinUrl: string;
};

/**
 * Commissioner control on the League tab: opens a sheet to invite someone by
 * email. On success it confirms delivery, and always surfaces the join link so
 * the commissioner can share it manually when email is unconfigured or the
 * invitee doesn't receive it.
 */
export function LeagueInviteButton({ leagueId }: LeagueInviteButtonProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<InviteSuccess | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) {
      return;
    }
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function reset() {
    setEmail("");
    setError(null);
    setSuccess(null);
    setCopied(false);
    setPending(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/v1/leagues/${leagueId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "The invite could not be sent.");
        return;
      }

      setSuccess({ email: body.invite.email, emailSent: Boolean(body.emailSent), joinUrl: body.joinUrl });
    } catch {
      setError("The invite could not be sent. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button className="secondary-button" type="button" onClick={() => setOpen(true)}>
        Invite manager
      </button>

      {open ? (
        <div className="sheet-overlay" role="presentation" onClick={close}>
          <div
            className="move-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-sheet-title"
            tabIndex={-1}
            ref={dialogRef}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="move-sheet-grabber" aria-hidden="true" />
            <div className="move-sheet-header">
              <h2 id="invite-sheet-title">Invite a manager</h2>
              <button className="move-sheet-close" type="button" aria-label="Close" onClick={close}>
                &times;
              </button>
            </div>

            {success ? (
              <div className="auth-form">
                <div className="status-banner good">
                  {success.emailSent
                    ? `Invite emailed to ${success.email}.`
                    : `Invite created for ${success.email}. Email isn't configured, so share this link:`}
                </div>
                {!success.emailSent ? (
                  <label className="field">
                    Join link
                    <input readOnly value={success.joinUrl} onFocus={(event) => event.currentTarget.select()} />
                  </label>
                ) : null}
                <button className="secondary-button" type="button" onClick={() => copyLink(success.joinUrl)}>
                  {copied ? "Copied" : "Copy join link"}
                </button>
                <button className="primary-button" type="button" onClick={reset}>
                  Invite another
                </button>
              </div>
            ) : (
              <form className="auth-form" onSubmit={submit}>
                <p className="move-sheet-subtitle">
                  They&apos;ll get a link to join as a manager with their own team. The link is single-use and expires in
                  7 days.
                </p>
                {error ? <div className="status-banner bad">{error}</div> : null}
                <label className="field">
                  Email
                  <input
                    autoComplete="email"
                    name="email"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="manager@example.com"
                  />
                </label>
                <button className="primary-button" disabled={pending || !email.trim()} type="submit">
                  {pending ? "Sending..." : "Send invite"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
