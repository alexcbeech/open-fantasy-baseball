"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/app/use-body-scroll-lock";
import type { FeedbackCategory } from "@/lib/data/feedback-schema";

type Status = "idle" | "submitting" | "success" | "error";

const MAX_LENGTH = 2000;

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("idea");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    };
  }, []);

  function resetAndClose() {
    setOpen(false);
    setStatus("idle");
    setMessage("");
    setCategory("idea");
    setErrorMessage("");
  }

  async function submitFeedback() {
    const trimmed = message.trim();

    if (!trimmed) {
      setStatus("error");
      setErrorMessage("Please write a little about your feedback.");
      textareaRef.current?.focus();
      return;
    }

    setStatus("submitting");
    setErrorMessage("");

    const context = {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      theme: document.documentElement.dataset.theme ?? "auto",
      locale: navigator.language,
      referrer: document.referrer || null,
    };

    try {
      const response = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          message: trimmed,
          pagePath: window.location.pathname + window.location.search,
          context,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; issues?: string[] };

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(result.issues?.[0] ?? result.error ?? "Feedback could not be submitted.");
        return;
      }

      setStatus("success");
      closeTimer.current = setTimeout(resetAndClose, 1800);
    } catch {
      setStatus("error");
      setErrorMessage("Feedback could not be submitted. Check your connection and try again.");
    }
  }

  return (
    <>
      {open ? <div className="feedback-backdrop" onClick={() => setOpen(false)} aria-hidden="true" /> : null}

      <button
        type="button"
        className="feedback-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="feedback-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
            fill="currentColor"
          />
        </svg>
        Feedback
      </button>

      {open ? (
        <div className="feedback-panel" id="feedback-panel" role="dialog" aria-modal="false" aria-labelledby="feedback-title">
          {status === "success" ? (
            <div className="feedback-success" role="status">
              <div className="feedback-success-check" aria-hidden="true">
                ✓
              </div>
              <p className="feedback-success-title">Thanks for the feedback!</p>
              <p className="feedback-success-note">We read every note that comes in.</p>
            </div>
          ) : (
            <>
              <div className="feedback-panel-header">
                <h2 id="feedback-title">Share feedback</h2>
                <button type="button" className="feedback-close" onClick={() => setOpen(false)} aria-label="Close feedback">
                  ✕
                </button>
              </div>

              <div className="feedback-segment" role="group" aria-label="Feedback type">
                <button type="button" aria-pressed={category === "idea"} onClick={() => setCategory("idea")}>
                  Idea
                </button>
                <button type="button" aria-pressed={category === "issue"} onClick={() => setCategory("issue")}>
                  Issue
                </button>
              </div>

              <textarea
                ref={textareaRef}
                className="feedback-textarea"
                value={message}
                maxLength={MAX_LENGTH}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  category === "idea"
                    ? "What would make Open Fantasy Baseball better?"
                    : "What went wrong? The more detail, the better."
                }
                aria-label="Your feedback"
              />

              {status === "error" ? (
                <p className="feedback-error" role="alert">
                  {errorMessage}
                </p>
              ) : (
                <p className="feedback-hint">This includes the page you&apos;re on to help us find it.</p>
              )}

              <div className="feedback-actions">
                <span className="feedback-count">
                  {message.length}/{MAX_LENGTH}
                </span>
                <button
                  type="button"
                  className="primary-button feedback-submit"
                  onClick={submitFeedback}
                  disabled={status === "submitting" || message.trim().length === 0}
                >
                  {status === "submitting" ? "Sending..." : "Send feedback"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
