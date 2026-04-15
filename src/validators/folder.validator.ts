import { z } from "zod";

export const createFolderSchema = z.object({
  name:    z.string().min(1).max(100),
  spaceId: z.string().uuid(),
  color:   z.string().optional(),
});

export const updateFolderSchema = z.object({
  name:         z.string().min(1).max(100).optional(),
  color:        z.string().optional(),
  displayOrder: z.number().int().optional(),
});

export const listFoldersSchema = z.object({
  spaceId:         z.string().uuid(),
  includeArchived: z.coerce.boolean().default(false),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type ListFoldersInput  = z.infer<typeof listFoldersSchema>;
