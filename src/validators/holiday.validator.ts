import { z } from "zod";

export const createHolidaySchema = z.object({
  name:        z.string().min(1, "กรุณากรอกชื่อวันหยุด"),
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องเป็น YYYY-MM-DD"),
  isRecurring: z.boolean().default(false),
  note:        z.string().optional(),
});

export const updateHolidaySchema = createHolidaySchema.partial();

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const listHolidaysSchema = z.object({
  year: z.coerce.number().int().optional(),
});

export const workingDaysSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องเป็น YYYY-MM-DD"),
  end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ต้องเป็น YYYY-MM-DD"),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
