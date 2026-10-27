const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** Protect cookie-authenticated API writes, including same-site sibling origins. */
export function isCrossOriginMutation(request: Request): boolean {
  if (safeMethods.has(request.method)) return false;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin !== new URL(request.url).origin;
  // CLI clients do not send browser fetch metadata. A cross-site browser
  // request must never gain access simply by omitting its Origin header.
  return request.headers.get("sec-fetch-site") === "cross-site";
}
