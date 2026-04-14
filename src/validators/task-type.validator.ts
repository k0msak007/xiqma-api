import { z } from "zod";

export const createTaskTypeSchema = z.object({
  name:            z.string().min(1, "กรุณากรอกชื่อ task type"),
  description:     z.string().optional(),
  color:           z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
  category:        z.enum(["private", "organization"]).default("organization"),
  countsForPoints: z.boolean().default(true),
  fixedPoints:     z.number().int().min(0).optional(),
});

export const updateTaskTypeSchema = createTaskTypeSchema.partial();

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateTaskTypeInput = z.infer<typeof createTaskTypeSchema>;
export type UpdateTaskTypeInput = z.infer<typeof updateTaskTypeSchema>;
