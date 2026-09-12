# Admin feedback email replies

Admins can open **Reply by email / history** under User Feedback, create a shared draft, paste a response, save, preview, then send. **Send and close feedback** closes the item only after the email provider accepts the message. A saved draft survives reloads; unsaved edits do not. Feedback without a recorded email address cannot receive a reply.

Apply `db/migrations/0034_feedback_replies.sql` with the normal migration workflow before deploying the feature. Keep the existing numbered migrations unchanged.

Configure the hosting environment with:

- `RESEND_API_KEY`: the existing Resend sending credential.
- `RESEND_FROM_EMAIL`: the existing official OFB sender on a domain verified in Resend.
- `RESEND_REPLY_TO_EMAIL`: a monitored inbox for users' replies.

The last setting is required for feedback sending, but does not change league invitation emails. Configure each relevant Vercel environment and deploy for environment changes to take effect. Drafts remain available without email configuration. Registration is handled separately by Neon Auth.

Only the recorded feedback recipient can receive these emails; the browser cannot override the destination or sender. Admin access, mutation throttling, same-origin checks, and audit events protect the reply API. Email bodies are stored in the private reply table, not duplicated in audit details or GitHub issues. Pasted markup is escaped, and the preview is sandboxed.

## Sending and retry behavior

The first send attempt persists the exact sender, Reply-To, HTML, text, recipient, subject, sending admin, and close choice. After this point the message is immutable. Each reply has a stable Resend idempotency key. Concurrent sends are claimed in the database, with a one-minute recovery lease if a request crashes. Retrying uses the stored payload, including after an environment or template change.

“Sent” means accepted by the provider, not confirmed inbox delivery. A timeout or missing provider receipt displays “Send unconfirmed.” Use **Retry saved reply** instead of composing the same email again. Automatic retries stop after 23 hours, before Resend's 24-hour idempotency window expires. After that, check the provider's sending records before composing another message. This first version does not ingest delivery/bounce webhooks or users' replies; replies arrive in the configured inbox.

Provider reference: https://resend.com/docs/api-reference/emails/send-email

Replies include OFB's logo and colors, the original feedback message, category, and reference ID in both the preview and sent email (with an equivalent plain-text reference). The logo uses the public HTTPS PNG at https://openfantasy.app/icons/icon-192.png; the brand name remains readable when images are blocked. The server loads reference content from the saved feedback record. Retries retain their original stored email payload.
Preview email opens a modal dialog with a scrollable email body and visible send controls. Close preview or Escape returns to the saved draft.
