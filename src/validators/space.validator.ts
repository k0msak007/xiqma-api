import { z } from "zod";

export const createSpaceSchema = z.object({
  name:       z.string().min(1).max(100),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#3b82f6"),
  icon:       z.string().optional(),
  memberIds:  z.array(z.string().uuid()).optional(),
});

export const updateSpaceSchema = z.object({
  name:         z.string().min(1).max(100).optional(),
  color:        z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon:         z.string().optional(),
  displayOrder: z.number().int().optional(),
});

export const addMembersSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
});

export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;
export type AddMembersInput  = z.infer<typeof addMembersSchema>;
