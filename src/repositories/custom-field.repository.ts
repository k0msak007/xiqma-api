import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";

export interface CustomFieldDef {
  id: string;
  listId: string;
  name: string;
  fieldType: "text" | "number" | "date" | "select";
  options: string[];
  required: boolean;
  displayOrder: number;
}

function rowToField(r: any): CustomFieldDef {
  return {
    id:           String(r.id),
    listId:       String(r.list_id),
    name:         String(r.name ?? ""),
    fieldType:    (r.field_type ?? "text") as CustomFieldDef["fieldType"],
    options:      Array.isArray(r.options) ? r.options.map(String) : [],
    required:     !!r.required,
    displayOrder: Number(r.display_order ?? 0),
  };
}

export const customFieldRepository = {
  async listByList(listId: string): Promise<CustomFieldDef[]> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT id, list_id, name, field_type, options, required, display_order
      FROM list_custom_fields WHERE list_id = '${listId}'::uuid ORDER BY display_order
    `));
    return ((rows as any).rows ?? rows as any[]).map(rowToField);
  },

  async create(data: { listId: string; name: string; fieldType: string; options?: string[]; required?: boolean; displayOrder?: number }): Promise<CustomFieldDef> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO list_custom_fields (list_id, name, field_type, options, required, display_order)
      VALUES ('${data.listId}'::uuid, '${data.name.replace(/'/g, "''")}', '${data.fieldType}',
        ${data.options?.length ? `'${JSON.stringify(data.options).replace(/'/g, "''")}'::jsonb` : "'[]'::jsonb"},
        ${data.required ?? false}, ${data.displayOrder ?? 0})
      RETURNING id, list_id, name, field_type, options, required, display_order
    `));
    return rowToField((((rows as any).rows ?? rows) as any[])[0]);
  },

  async remove(id: string): Promise<void> {
    await db.execute(sql.raw(`DELETE FROM list_custom_fields WHERE id = '${id}'::uuid`));
  },
};
