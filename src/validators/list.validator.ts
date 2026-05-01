import { z } from "zod";

export const createListSchema = z.object({
  name:     z.string().min(1).max(100),
  spaceId:  z.string().uuid(),
  folderId: z.string().uuid().optional(),
  color:    z.string().optional(),
});

export const updateListSchema = z.object({
  name:         z.string().min(1).max(100).optional(),
  color:        z.string().optional(),
  displayOrder: z.number().int().optional(),
});

export const listQuerySchema = z.object({
  spaceId:  z.string().uuid("spaceId ต้องเป็น UUID"),
  folderId: z.string().uuid().optional(),
});

export const createStatusSchema = z.object({
  name:  z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
  type:  z.enum(["open", "in_progress", "paused", "review", "done", "closed", "cancelled", "blocked"]),
});

export const updateStatusSchema = z.object({
  name:  z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  type:  z.enum(["open", "in_progress", "review", "done", "closed"]).optional(),
});

export const reorderStatusSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export type CreateListInput    = z.infer<typeof createListSchema>;
export type UpdateListInput    = z.infer<typeof updateListSchema>;
export type CreateStatusInput  = z.infer<typeof createStatusSchema>;
export type UpdateStatusInput  = z.infer<typeof updateStatusSchema>;
export type ReorderStatusInput = z.infer<typeof reorderStatusSchema>;
