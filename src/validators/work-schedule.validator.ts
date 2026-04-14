import { z } from "zod";

export const createWorkScheduleSchema = z.object({
  name:          z.string().min(1, "กรุณากรอกชื่อ work schedule"),
  daysPerWeek:   z.number().min(1).max(7).default(5),
  hoursPerDay:   z.number().min(1).max(24).default(8),
  workDays:      z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  workStartTime: z.string().regex(/^\d{2}:\d{2}$/, "ต้องเป็น HH:MM").default("09:00"),
  workEndTime:   z.string().regex(/^\d{2}:\d{2}$/, "ต้องเป็น HH:MM").default("18:00"),
  isDefault:     z.boolean().default(false),
});

export const updateWorkScheduleSchema = createWorkScheduleSchema.partial();

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>;
