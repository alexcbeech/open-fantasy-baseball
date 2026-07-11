import type { ReactNode } from "react";

/**
 * Full-height hero layout shared by the signed-out pages (sign-in, sign-up,
 * league invite): the brand lockup sits centered above a single elevated
 * card, instead of hiding in the app topbar corner.
 */
export function AuthShell({
  kicker = "Open Fantasy",
  title = "Baseball",
  children,
}: {
  kicker?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <div className="auth-layout">
        <div className="auth-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-brand-mark" src="/brand/ofb-mark.svg" alt="" width={88} height={88} aria-hidden="true" />
          <span className="brand-text">
            <span className="brand-kicker">{kicker}</span>
            <span className="brand-title">{title}</span>
          </span>
        </div>
        <div className="panel auth-card">{children}</div>
      </div>
    </main>
  );
}
