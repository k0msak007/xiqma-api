import { z } from "zod";

export const createTaskSchema = z.object({
  title:              z.string().min(1, "กรุณากรอกชื่องาน"),
  description:        z.string().optional(),
  listId:             z.string().uuid("list_id ไม่ถูกต้อง"),
  listStatusId:       z.string().uuid().optional(),
  taskTypeId:         z.string().uuid().optional(),
  priority:           z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assigneeId:         z.string().uuid("assignee_id ไม่ถูกต้อง"),
  storyPoints:        z.number().int().refine((v) => [1,2,3,5,8,13,21].includes(v)).optional(),
  timeEstimateHours:  z.number().positive().optional(),
  planStart:          z.string().date().optional(),
  durationDays:       z.number().int().positive().optional(),
  deadline:           z.string().datetime().optional(),
  tags:               z.array(z.string()).default([]),
});

export const updateTaskSchema = createTaskSchema.partial().omit({ listId: true });

export const patchStatusSchema = z.object({
  listStatusId: z.string().uuid("list_status_id ไม่ถูกต้อง"),
  status:       z.enum([
    "pending","in_progress","paused","review",
    "completed","cancelled","blocked","overdue",
  ]).optional(),
});

export const reorderTasksSchema = z.object({
  listId:         z.string().uuid(),
  statusId:       z.string().uuid(),
  orderedTaskIds: z.array(z.string().uuid()).min(1),
});

export const listTasksSchema = z.object({
  listId:     z.string().uuid().optional(),
  statusId:   z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority:   z.enum(["low","normal","high","urgent"]).optional(),
  search:     z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(50),
  sort:       z.enum(["deadline","created_at","priority","display_order"]).default("display_order"),
  order:      z.enum(["asc","desc"]).default("asc"),
});

export type CreateTaskInput  = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput  = z.infer<typeof updateTaskSchema>;
export type PatchStatusInput = z.infer<typeof patchStatusSchema>;
export type ReorderInput     = z.infer<typeof reorderTasksSchema>;
export type ListTasksInput   = z.infer<typeof listTasksSchema>;
