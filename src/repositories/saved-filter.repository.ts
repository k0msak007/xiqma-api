import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";

export interface SavedFilter {
  id: string;
  name: string;
  listId: string;
  userId: string;
  config: Record<string, any>;
  isDefault: boolean;
  createdAt: string;
}

function rowToFilter(r: any): SavedFilter {
  return {
    id:        String(r.id),
    name:      String(r.name ?? ""),
    listId:    String(r.list_id ?? ""),
    userId:    String(r.user_id ?? ""),
    config:    r.config ?? {},
    isDefault: !!r.is_default,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
  };
}

export const savedFilterRepository = {
  async listByUser(userId: string, listId: string): Promise<SavedFilter[]> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT id, name, list_id, user_id, config, is_default, created_at
      FROM saved_filters WHERE user_id = '${userId}'::uuid AND list_id = '${listId}'::uuid
      ORDER BY created_at
    `));
    return ((rows as any).rows ?? rows as any[]).map(rowToFilter);
  },

  async create(input: { name: string; listId: string; userId: string; config: Record<string, any> }): Promise<SavedFilter> {
    const json = JSON.stringify(input.config).replace(/'/g, "''");
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO saved_filters (name, list_id, user_id, config)
      VALUES ('${input.name.replace(/'/g, "''")}', '${input.listId}'::uuid, '${input.userId}'::uuid, '${json}'::jsonb)
      RETURNING id, name, list_id, user_id, config, is_default, created_at
    `));
    return rowToFilter((((rows as any).rows ?? rows) as any[])[0]);
  },

  async remove(id: string, userId: string): Promise<void> {
    await db.execute(sql.raw(`
      DELETE FROM saved_filters WHERE id = '${id}'::uuid AND user_id = '${userId}'::uuid
    `));
  },
};
