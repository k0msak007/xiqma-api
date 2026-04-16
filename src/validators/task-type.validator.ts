import { z } from "zod";

export const listTaskTypesSchema = z.object({
  category: z.enum(["private", "organization"]).optional(),
});

// Base object — ใช้ร่วมกันระหว่าง create และ update
const taskTypeBaseSchema = z.object({
  name:            z.string().min(1, "กรุณากรอกชื่อ task type"),
  description:     z.string().optional(),
  color:           z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
  category:        z.enum(["private", "organization"]).default("organization"),
  countsForPoints: z.boolean().default(true),
  fixedPoints:     z.number().int().min(0).optional(),
});

export const createTaskTypeSchema = taskTypeBaseSchema.refine(
  (d) => d.category !== "private" || d.fixedPoints !== undefined,
  { message: "fixedPoints จำเป็นเมื่อ category เป็น private", path: ["fixedPoints"] }
);

export const updateTaskTypeSchema = taskTypeBaseSchema.partial().refine(
  (d) => {
    // ตรวจเฉพาะเมื่อ category ถูก set เป็น private ในการ update
    if (d.category === "private" && d.fixedPoints === undefined) return false;
    return true;
  },
  { message: "fixedPoints จำเป็นเมื่อ category เป็น private", path: ["fixedPoints"] }
);

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export type ListTaskTypesInput  = z.infer<typeof listTaskTypesSchema>;
export type CreateTaskTypeInput = z.infer<typeof createTaskTypeSchema>;
export type UpdateTaskTypeInput = z.infer<typeof updateTaskTypeSchema>;
