import { z } from "zod";

export const announcementContentSchema = z.object({
  subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/),
  body: z.string().trim().min(1).max(10_000),
  buttonLabel: z.string().trim().max(60),
  buttonUrl: z.union([z.literal(""), z.url().refine(value => new URL(value).protocol === "https:")]),
}).refine(value => Boolean(value.buttonLabel) === Boolean(value.buttonUrl), "Provide both a button label and HTTPS URL.");
export type AnnouncementContent = z.infer<typeof announcementContentSchema>;
export type AdminAnnouncement = AnnouncementContent & {
  id: string; revision: number; status: "draft" | "queued";
  author: string; sender: string | null; createdAt: string; queuedAt: string | null;
  total: number; accepted: number; pending: number; unconfirmed: number; blocked: number;
};
export type AnnouncementSettings = { configured: boolean; canDraft: boolean; from: string | null; replyTo: string | null };
