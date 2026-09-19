import type { ReactNode } from "react";

/** Native disclosure keeps forms mounted and supports keyboard toggling. */
export function AdminSection({ title, id, meta, className = "", children }: {
  title: string;
  id: string;
  meta?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel admin-section ${className}`} aria-labelledby={id}>
      <details>
        <summary className="admin-section-summary">
          <h2 id={id}>{title}</h2>
          {meta ? <span className="subtle admin-section-meta">{meta}</span> : null}
        </summary>
        <div className="admin-section-body">{children}</div>
      </details>
    </section>
  );
}
