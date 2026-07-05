/**
 * Account creation is gated so it can be closed while OFB is still in progress.
 * Disabled by default; set ALLOW_SIGNUPS=true to re-enable. Sign-in and existing
 * accounts are unaffected -- this only blocks creating new ones.
 */
export function areSignupsEnabled(): boolean {
  return process.env.ALLOW_SIGNUPS === "true";
}
