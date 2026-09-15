# User deactivation

Administrators manage accounts in **Admin → Users**. Search by name or email,
choose **Deactivate**, optionally record a reason, and confirm. The account keeps
its identity, team ownership, and league history. Reassigning a team or enabling
bot management is a separate commissioner action.

Deactivation blocks OFB session access, API tokens, and MCP tool access. The app
checks the account in Postgres on each identity resolution, including when the
provider returns a cached session. Database failures never grant an identity.
Email/Google sign-in cannot recreate or relink a blocked account. Existing
provider identities are resolved before email matching.

The operation revokes API credentials and push subscriptions, skips queued push
notifications, blocks queued announcement recipients, and cancels feedback
replies. All application email sends (including invitations) and push deliveries
recheck eligibility under a transaction lock shared with account deactivation.
An email/push already handed to its provider may still arrive. Public pages and
information already downloaded cannot be withdrawn.

Neon Auth sessions are revoked and the provider account is banned. If the
provider is unavailable, the application block still commits and **Retry
authentication sync** remains visible. No success claim is made about provider
synchronization until both operations succeed. An admin cannot change their own
account; the acting administrator is checked again under a global transaction
lock, preventing concurrent account changes from removing the last active admin.
Every successful change and sync retry is audited in the same database transaction.

**Reactivate** first revokes provider sessions and removes the provider ban; if
either fails, the app account remains inactive. After success, only sessions
created after reactivation are accepted. Old tokens, subscriptions, and canceled
messages stay disabled. Users can create new API tokens and enable push again.

## Deployment

Apply `db/migrations/0036_user_deactivation.sql` before deploying the new app or
running its notification workers. It adds account status, session cutoffs, audit
attribution, and revision/sync fields, and permits canceled feedback replies.
Existing accounts remain active. The previous app version tolerates the added
columns, but does not enforce them: deactivation requires deploying this version
to all app and worker instances. Do not deactivate users during a mixed-version
rollout. A code rollback also removes OFB's deactivation enforcement.

## Authentication-provider emails

OFB's auth proxy suppresses email sign-in, sign-up, reset, verification, and OTP
requests for deactivated addresses and rejects inactive cached sessions. Raw
provider admin routes are disabled in the proxy so account changes use OFB's
audited controls. Emails initiated directly against the hosted Neon Auth service
are controlled by that service, not this proxy. Provider-side email suppression
must be configured separately if *all authentication emails*, including direct
upstream requests, must be prevented. OFB does not send a deactivation email.

## Verification

Unit tests cover account/session cutoffs, identity preservation, database/provider
failure behavior, notification suppression, transaction/audit behavior, admin
authorization, same-origin checks, and rate limiting. Browser tests cover
confirmation/cancel, reason persistence, stale-state errors, reactivation, self
protection, and provider sync retries with isolated API fixtures.
