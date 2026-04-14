import { z } from "zod";

export const createPositionSchema = z.object({
  name:             z.string().min(1, "กรุณากรอกชื่อตำแหน่ง"),
  department:       z.string().optional(),
  level:            z.number().int().min(1).max(10).default(6),
  jobLevelCode:     z.string().optional(),
  color:            z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#6b7280"),
  parentPositionId: z.string().uuid().optional(),
});

export const updatePositionSchema = createPositionSchema.partial();

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
