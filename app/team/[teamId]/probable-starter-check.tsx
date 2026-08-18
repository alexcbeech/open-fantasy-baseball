/** Green badge (white check on a filled circle) for today's probable starter. */
export function ProbableStarterCheck() {
  return (
    <span className="probable-start-check" title="Scheduled to start today" aria-label="Scheduled to start today" role="img">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="currentColor" />
        <path d="M6.5 12.5 10.5 16.5 17.5 8" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
