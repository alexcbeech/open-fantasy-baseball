/** Only browser push services may receive server-side Web Push requests. */
export function canonicalPushEndpoint(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
    const allowed = url.hostname === "fcm.googleapis.com"
      || url.hostname === "updates.push.services.mozilla.com"
      || url.hostname.endsWith(".push.apple.com")
      || url.hostname.endsWith(".notify.windows.com");
    // web-push uses the legacy URL parser. Pass only this canonical spelling
    // downstream so percent-encoded hosts cannot change its destination.
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  return canonicalPushEndpoint(endpoint) !== null;
}
