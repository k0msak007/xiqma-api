import { z } from "zod";

export const taskQuerySchema = z.object({
  listId:     z.string().uuid(),
  statusId:   z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  priority:   z.enum(["low","normal","high","urgent"]).optional(),
  search:     z.string().optional(),
  page:       z.coerce.number().int().min(1).optional().default(1),
  limit:      z.coerce.number().int().min(1).max(500).optional().default(20),
  sort:       z.enum(["display_order","deadline","created_at","priority"]).optional().default("display_order"),
});

export const myTasksQuerySchema = z.object({
  range: z.enum(["today","week","month"]).optional(),
});

export const calendarQuerySchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const createTaskSchema = z.object({
  title:             z.string().min(1),
  listId:            z.string().uuid(),
  listStatusId:      z.string().uuid().optional(),
  taskTypeId:        z.string().uuid().optional(),
  priority:          z.enum(["low","normal","high","urgent"]).optional().default("normal"),
  assigneeId:        z.string().uuid(),
  storyPoints:       z.number().int().optional(),
  mandayEstimate:    z.number().optional(),
  timeEstimateHours: z.number().optional(),
  planStart:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  durationDays:      z.number().int().min(1).optional(),
  deadline:          z.string().datetime({ offset: true }).optional(),
  description:       z.string().optional(),
  tags:              z.array(z.string()).optional().default([]),
  source:            z.string().optional().default("manager_assigned"),
});

export const updateTaskSchema = z.object({
  title:             z.string().min(1).optional(),
  listStatusId:      z.string().uuid().optional().nullable(),
  taskTypeId:        z.string().uuid().optional().nullable(),
  priority:          z.enum(["low","normal","high","urgent"]).optional(),
  assigneeId:        z.string().uuid().optional(),
  storyPoints:       z.number().int().optional().nullable(),
  mandayEstimate:    z.number().optional().nullable(),
  timeEstimateHours: z.number().optional().nullable(),
  planStart:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  durationDays:      z.number().int().min(1).optional().nullable(),
  deadline:          z.string().datetime({ offset: true }).optional().nullable(),
  description:       z.string().optional().nullable(),
  tags:              z.array(z.string()).optional(),
  estimateProgress: z.number().int().min(0).max(100).optional().nullable(),
  blockedNote:       z.string().optional().nullable(),
});

export const updateTaskStatusSchema = z.object({
  listStatusId: z.string().uuid(),
  status:       z.enum(["pending","in_progress","paused","review","completed","cancelled","blocked","overdue"]).optional(),
});

export const reorderTasksSchema = z.object({
  listId:         z.string().uuid(),
  statusId:       z.string().uuid(),
  orderedTaskIds: z.array(z.string().uuid()).min(1),
});

// Subtask
export const createSubtaskSchema = z.object({
  title:      z.string().min(1),
  assigneeId: z.string().uuid().optional(),
});

export const updateSubtaskSchema = z.object({
  title:        z.string().min(1).optional(),
  assigneeId:   z.string().uuid().optional().nullable(),
  displayOrder: z.number().int().optional(),
});

// Comment
export const createCommentSchema = z.object({
  commentText: z.string().min(1),
});

export const updateCommentSchema = z.object({
  commentText: z.string().min(1),
});

// Extension request
export const createExtensionRequestSchema = z.object({
  newDeadline: z.string().datetime({ offset: true }),
  reason:      z.string().min(1),
});

export const rejectExtensionSchema = z.object({
  rejectReason: z.string().min(1),
});

// Search
export const searchQuerySchema = z.object({
  q:     z.string().min(2),
  types: z.string().optional(), // comma-separated: "task,space,employee"
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export type CreateTaskInput        = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput        = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusInput  = z.infer<typeof updateTaskStatusSchema>;
export type ReorderTasksInput      = z.infer<typeof reorderTasksSchema>;
export type CreateSubtaskInput     = z.infer<typeof createSubtaskSchema>;
export type UpdateSubtaskInput     = z.infer<typeof updateSubtaskSchema>;
export type CreateCommentInput     = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput     = z.infer<typeof updateCommentSchema>;
export type CreateExtensionInput   = z.infer<typeof createExtensionRequestSchema>;
export type RejectExtensionInput   = z.infer<typeof rejectExtensionSchema>;
