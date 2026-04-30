import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string | null;
  taskTypeId: string | null;
  priority: string | null;
  timeEstimateHours: number | null;
  storyPoints: number | null;
  tags: string[];
  isPublic: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToTemplate(r: any): TaskTemplate {
  return {
    id:                String(r.id),
    name:              String(r.name ?? ""),
    title:             String(r.title ?? ""),
    description:       r.description ? String(r.description) : null,
    taskTypeId:        r.task_type_id ? String(r.task_type_id) : null,
    priority:          r.priority ? String(r.priority) : null,
    timeEstimateHours: r.time_estimate_hours != null ? Number(r.time_estimate_hours) : null,
    storyPoints:        r.story_points != null ? Number(r.story_points) : null,
    tags:              Array.isArray(r.tags) ? r.tags.map((t: any) => String(t)) : [],
    isPublic:          !!r.is_public,
    createdBy:         r.created_by ? String(r.created_by) : null,
    createdAt:         r.created_at ? new Date(r.created_at).toISOString() : "",
    updatedAt:         r.updated_at ? new Date(r.updated_at).toISOString() : "",
  };
}

export const taskTemplateRepository = {
  async list(): Promise<TaskTemplate[]> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT id, name, title, description, task_type_id, priority,
             time_estimate_hours, story_points, tags,
             is_public, created_by, created_at, updated_at
      FROM task_templates ORDER BY name
    `));
    return ((rows as any).rows ?? rows as any[]).map(rowToTemplate);
  },

  async findById(id: string): Promise<TaskTemplate | null> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT id, name, title, description, task_type_id, priority,
             time_estimate_hours, story_points, tags,
             is_public, created_by, created_at, updated_at
      FROM task_templates WHERE id = '${id}'::uuid LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? rowToTemplate(r) : null;
  },

  async create(input: { name: string; title: string; description?: string | null; taskTypeId?: string | null; priority?: string | null; timeEstimateHours?: number | null; storyPoints?: number | null; tags?: string[]; createdBy?: string }): Promise<TaskTemplate> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO task_templates (name, title, description, task_type_id, priority, time_estimate_hours, story_points, tags, created_by)
      VALUES (
        '${input.name.replace(/'/g, "''")}',
        '${input.title.replace(/'/g, "''")}',
        ${input.description ? `'${input.description.replace(/'/g, "''")}'` : "NULL"},
        ${input.taskTypeId ? `'${input.taskTypeId}'::uuid` : "NULL"},
        ${input.priority ? `'${input.priority}'` : "NULL"},
        ${input.timeEstimateHours != null ? input.timeEstimateHours : "NULL"},
        ${input.storyPoints != null ? input.storyPoints : "NULL"},
        ${input.tags?.length ? `'${JSON.stringify(input.tags)}'::jsonb` : "'[]'::jsonb"},
        ${input.createdBy ? `'${input.createdBy}'::uuid` : "NULL"}
      )
      RETURNING id, name, title, description, task_type_id, priority, time_estimate_hours, story_points, tags, is_public, created_by, created_at, updated_at
    `));
    return rowToTemplate((((rows as any).rows ?? rows) as any[])[0]);
  },

  async remove(id: string): Promise<void> {
    await db.execute(sql.raw(`DELETE FROM task_templates WHERE id = '${id}'::uuid`));
  },
};
