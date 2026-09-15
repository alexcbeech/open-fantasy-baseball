# Admin email announcements

Admins can create announcements from **Admin → Email Announcements**. Save a
subject and message, optionally add an HTTPS button, preview the email, send a
test to the signed-in admin, then review the recipient count and confirm sending.
Drafts are shared between admins; revision checks prevent overwriting a newer edit.

## Setup

- Apply `db/migrations/0035_admin_announcements.sql` through `npm run db:migrate`.
- Use the existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and
  `RESEND_REPLY_TO_EMAIL` configuration. The reply inbox should be monitored.
- Deploy on a host supporting Next.js `after` and a 300-second route duration.

Recipients are app accounts linked to a Neon Auth identity. Addresses are
normalized and deduplicated; invalid addresses, `.local` addresses, and
`example.com` demo addresses are excluded. This initial feature is for service
updates to registered users; audience filters and subscription preferences are
not part of this release.

## Sending and recovery

The confirmation stores the recipient snapshot and rendered message in one
transaction before delivery. If the audience changes after review, the admin
must review it again. Each recipient receives an individual email; no address
list is exposed to other recipients.

Delivery runs after the HTTP response, for up to four minutes. Closing the tab
does not stop that run. The history refreshes every ten seconds while work is
outstanding. For a larger audience, an interrupted invocation, or a provider
error, use **Resume pending / retry unconfirmed** to process the remaining work.
This release does not include an automatic scheduled worker.

**Accepted** means Resend accepted the message, not that it reached the inbox.
**Unconfirmed** means an attempt might have reached Resend but acceptance could
not be confirmed. Retries use the same saved payload and recipient-specific
idempotency key; accepted recipients are never selected again. A one-minute
lease protects in-flight attempts. After 23 hours, uncertain attempts move to
manual review instead of risking duplicates beyond Resend's 24-hour key window.
Check those messages in Resend before composing another announcement.

Send, draft, test, resume, and failure actions are recorded in the audit log.
Tests mock delivery and do not send real announcements.
