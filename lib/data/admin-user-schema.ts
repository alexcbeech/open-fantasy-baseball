import { z } from "zod";

export const accountCommandSchema = z.object({
  userId: z.uuid(),
  revision: z.number().int().nonnegative(),
  action: z.enum(["deactivate", "reactivate", "retry-auth"]),
  reason: z.string().trim().max(1000).optional(),
}).strict();
export type AccountCommand = z.infer<typeof accountCommandSchema>;
export type AdminUser = {
  id: string; email: string; displayName: string;
  deactivatedAt: string | null; deactivatedBy: string | null;
  reason: string | null; revision: number; authSyncPending: boolean;
};
