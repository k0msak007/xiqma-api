import { z } from "zod";

export const updateProfileSchema = z.object({
  name:  z.string().min(1, "กรุณากรอกชื่อ").optional(),
  email: z.string().email("Email ไม่ถูกต้อง").optional(),
});

export const listNotificationsSchema = z.object({
  unread: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export const listAuditLogsSchema = z.object({
  actor_id:   z.string().uuid().optional(),
  table_name: z.string().optional(),
  action:     z.string().optional(),
  from:       z.string().optional(),
  to:         z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
});

export type UpdateProfileInput    = z.infer<typeof updateProfileSchema>;
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;
export type ListAuditLogsInput     = z.infer<typeof listAuditLogsSchema>;
