import { z } from "zod";

export const createRoleSchema = z.object({
  name:        z.string().min(1, "กรุณากรอกชื่อ role"),
  description: z.string().optional(),
  color:       z.string().regex(/^#[0-9a-fA-F]{6}$/, "สีต้องเป็น hex").default("#6b7280"),
  permissions: z.array(z.string()).default([]),
});

export const updateRoleSchema = createRoleSchema;

export const idParamSchema = z.object({
  id: z.string().uuid("id ต้องเป็น UUID"),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
