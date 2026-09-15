import { createHash } from "node:crypto";
import { z } from "zod";
import { getPool, isDatabaseConfigured, query } from "@/lib/db/client";
import { sendEmail } from "@/lib/notifications/email";
import { feedbackReplySettings } from "./feedback-replies";
import { announcementEmailHtml, announcementEmailText } from "@/lib/notifications/announcement-email";
import { announcementContentSchema, type AdminAnnouncement, type AnnouncementContent } from "./admin-announcement-schema";

export class AnnouncementError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const announcementSettings = () => ({ ...feedbackReplySettings(), canDraft: isDatabaseConfigured(), configured: isDatabaseConfigured() && feedbackReplySettings().configured });
const columns = `a.id, a.subject, a.body, a.button_label as "buttonLabel", a.button_url as "buttonUrl", a.revision, a.status,
 a.author, a.sender, a.created_at::text as "createdAt", a.queued_at::text as "queuedAt",
 count(r.email)::int as total, count(*) filter (where r.status = 'accepted')::int as accepted,
 count(*) filter (where r.status in ('pending','sending'))::int as pending,
 count(*) filter (where r.status = 'unconfirmed')::int as unconfirmed,
 count(*) filter (where r.status = 'blocked')::int as blocked`;
export async function listAdminAnnouncements() {
  if (!isDatabaseConfigured()) return [];
  return (await query<AdminAnnouncement>(`select ${columns} from admin_announcement a
    left join admin_announcement_recipient r on r.announcement_id = a.id group by a.id order by a.created_at desc limit 100`)).rows;
}
export function eligibleAnnouncementEmails(emails: string[]) {
  return [...new Set(emails.map(email => email.trim().toLowerCase()).filter(email =>
    z.email().safeParse(email).success && !email.endsWith(".local") && !email.endsWith("@example.com")))].sort();
}
async function audience() {
  // Only real app accounts with a linked sign-in identity; excludes seeded/demo users and invitations.
  const rows = await query<{ email: string }>(`select u.email from app_user u where exists
    (select 1 from auth_identity i where i.user_id = u.id and i.provider = 'neon-auth')`);
  const emails = eligibleAnnouncementEmails(rows.rows.map(row => row.email));
  return { emails, token: createHash("sha256").update(JSON.stringify(emails)).digest("hex") };
}
export async function reviewAnnouncementAudience() {
  const result = await audience();
  return { count: result.emails.length, token: result.token };
}
export async function createAdminAnnouncement(author: string) {
  return (await query<{ id: string }>("insert into admin_announcement(author) values ($1) returning id", [author])).rows[0].id;
}
export async function saveAdminAnnouncement(id: string, revision: number, content: AnnouncementContent, author: string) {
  const result = await query(`update admin_announcement set subject=$3, body=$4, button_label=$5, button_url=$6,
    author=$7, revision=revision+1 where id=$1 and revision=$2 and status='draft' returning id`,
  [id, revision, content.subject, content.body, content.buttonLabel, content.buttonUrl, author]);
  if (!result.rowCount) throw new AnnouncementError("This draft changed or was already queued. Reload before continuing.");
}
async function savedContent(id: string, revision: number) {
  const result = await query<AnnouncementContent>(`select subject, body, button_label as "buttonLabel", button_url as "buttonUrl"
    from admin_announcement where id=$1 and revision=$2 and status='draft'`, [id, revision]);
  const parsed = announcementContentSchema.safeParse(result.rows[0]);
  if (!parsed.success) throw new AnnouncementError("Save a complete draft before continuing.");
  return parsed.data;
}
export async function testAdminAnnouncement(id: string, revision: number, email: string) {
  const settings = announcementSettings();
  if (!settings.configured) throw new AnnouncementError("Configure the database, email sender, and monitored Reply-To inbox first.", 503);
  const content = await savedContent(id, revision);
  const result = await sendEmail({ to: email, subject: `[Test] ${content.subject}`, html: announcementEmailHtml(content),
    text: announcementEmailText(content), from: settings.from!, replyTo: settings.replyTo! });
  if (!result.ok || !result.id) throw new AnnouncementError("Test email could not be confirmed. Check your inbox before retrying.", 502);
}
export async function queueAdminAnnouncement(id: string, revision: number, audienceToken: string, sender: string) {
  const settings = announcementSettings();
  if (!settings.configured) throw new AnnouncementError("Configure the database, email sender, and monitored Reply-To inbox first.", 503);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const locked = await client.query<{ status: string; revision: number }>("select status, revision from admin_announcement where id=$1 for update", [id]);
    const existing = locked.rows[0];
    if (!existing || existing.revision !== revision) throw new AnnouncementError("This draft changed. Reload and review again.");
    if (existing.status === "queued") { await client.query("commit"); return; }
    const content = await savedContent(id, revision);
    const recipients = await audience();
    if (recipients.token !== audienceToken) throw new AnnouncementError("The recipient list changed. Review recipients again before sending.");
    if (!recipients.emails.length) throw new AnnouncementError("There are no eligible recipients.", 400);
    await client.query(`update admin_announcement set status='queued', sender=$2, queued_at=now(),
      from_address=$3, reply_to=$4, html=$5, email_text=$6 where id=$1`,
    [id, sender, settings.from, settings.replyTo, announcementEmailHtml(content), announcementEmailText(content)]);
    await client.query(`insert into admin_announcement_recipient(announcement_id,email) select $1, unnest($2::text[])`, [id, recipients.emails]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}

// Durable outbox, immutable payloads and one leased recipient at a time. A dropped
// invocation can resume without resending accepted recipients. Never retry beyond
// the provider's 24-hour deduplication window (one hour of margin).
export async function processAdminAnnouncement(id: string, budgetMs = 240_000) {
  const start = Date.now();
  const payload = (await query<{ subject: string; html: string; text: string; from: string; replyTo: string }>(
    `select subject, html, email_text as text, from_address as "from", reply_to as "replyTo" from admin_announcement where id=$1 and status='queued'`, [id])).rows[0];
  if (!payload) throw new AnnouncementError("Queued announcement was not found.", 404);
  while (Date.now() - start < budgetMs) {
    await query(`update admin_announcement_recipient set status='blocked' where announcement_id=$1
      and status in ('sending','unconfirmed') and first_attempt_at <= now() - interval '23 hours'`, [id]);
    const recipient = (await query<{ email: string }>(`update admin_announcement_recipient set status='sending',
      first_attempt_at=coalesce(first_attempt_at,now()), attempt_at=now()
      where (announcement_id,email) = (select announcement_id,email from admin_announcement_recipient
        where announcement_id=$1 and (status='pending' or (status in ('sending','unconfirmed') and attempt_at < now() - interval '1 minute'))
        and (first_attempt_at is null or first_attempt_at > now() - interval '23 hours')
        order by email for update skip locked limit 1) returning email`, [id])).rows[0];
    if (!recipient) break;
    const key = createHash("sha256").update(recipient.email).digest("hex");
    const result = await sendEmail({ ...payload, to: recipient.email, idempotencyKey: `announcement/${id}/${key}` });
    await query(`update admin_announcement_recipient set status=$3, provider_id=$4,
      accepted_at=case when $3='accepted' then now() else null end where announcement_id=$1 and email=$2`,
    [id, recipient.email, result.ok && result.id ? "accepted" : "unconfirmed", result.ok ? result.id : null]);
    // Avoid an error storm on provider outages/rate limits. Admin can resume later.
    if (!result.ok || !result.id) break;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
}
