/**
 * Topbar brand lockup: the OFB plate mark next to a kicker/title pair, so
 * every page carries the logo, not just home. `clip` lets pages whose title
 * is a live name (league/team) ellipsize instead of pushing the topbar
 * actions off a phone screen. Omit kicker/title to show the mark alone —
 * the mark then carries the accessible name itself.
 */
export function BrandLockup({ kicker, title, clip = false }: { kicker?: string; title?: string; clip?: boolean }) {
  const markOnly = !kicker && !title;
  return (
    <div className={`brand-lockup brand-lockup--logo${clip ? " brand-lockup--clip" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="brand-mark"
        src="/brand/ofb-mark.svg"
        alt={markOnly ? "Open Fantasy Baseball" : ""}
        width={40}
        height={40}
        aria-hidden={markOnly ? undefined : "true"}
      />
      {markOnly ? null : (
        <span className="brand-text">
          <span className="brand-kicker">{kicker}</span>
          <span className="brand-title">{title}</span>
        </span>
      )}
    </div>
  );
}
