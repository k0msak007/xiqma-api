import { eq, and, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { lists, listStatuses } from "@/db/schema/workspace.schema.ts";
import type { CreateListInput, UpdateListInput, CreateStatusInput, UpdateStatusInput } from "@/validators/list.validator.ts";

// Default statuses for new lists
const DEFAULT_STATUSES = [
  { name: "Open",        color: "#6b7280", type: "open"        as const, displayOrder: 1 },
  { name: "In Progress", color: "#3b82f6", type: "in_progress" as const, displayOrder: 2 },
  { name: "Review",      color: "#f59e0b", type: "review"      as const, displayOrder: 3 },
  { name: "Done",        color: "#22c55e", type: "done"        as const, displayOrder: 4 },
  { name: "Closed",      color: "#8b5cf6", type: "closed"      as const, displayOrder: 5 },
];

export const listRepository = {
  async findAll(spaceId: string, folderId?: string) {
    const conditions = folderId
      ? and(eq(lists.spaceId, spaceId), eq(lists.folderId, folderId))
      : eq(lists.spaceId, spaceId);

    // Get lists
    const rows = await db
      .select({
        id:           lists.id,
        name:         lists.name,
        spaceId:      lists.spaceId,
        folderId:     lists.folderId,
        color:        lists.color,
        displayOrder: lists.displayOrder,
        createdAt:    lists.createdAt,
      })
      .from(lists)
      .where(conditions)
      .orderBy(asc(lists.displayOrder));

    if (rows.length === 0) return rows;

    // Get statuses for these lists only
    const listIds = rows.map(r => r.id);
    const allStatuses = await db
      .select()
      .from(listStatuses)
      .where(sql`${listStatuses.listId} IN (${sql.join(listIds.map(id => sql`${id}::uuid`), sql`, `)})`);
    
    // Filter by list IDs and attach to each row
    const result = rows.map(row => {
      const rowStatuses = allStatuses.filter(s => s.listId === row.id);
      return {
        ...row,
        taskCount: 0,
        doneCount: 0,
        statuses: rowStatuses.sort((a, b) => a.displayOrder - b.displayOrder),
      };
    });

    return result;
  },

  async findById(id: string) {
    const list = await db.query.lists.findFirst({
      where: eq(lists.id, id),
    });
    if (!list) return null;
    
    const statuses = await db
      .select()
      .from(listStatuses)
      .where(eq(listStatuses.listId, id))
      .orderBy(asc(listStatuses.displayOrder));
    
    return { ...list, statuses };
  },

  async getMaxDisplayOrder(spaceId: string) {
    const result = await db
      .select({ max: sql<number>`COALESCE(MAX(display_order), 0)`.mapWith(Number) })
      .from(lists)
      .where(eq(lists.spaceId, spaceId));
    return result[0]?.max ?? 0;
  },

  async create(data: CreateListInput) {
    const maxOrder = await this.getMaxDisplayOrder(data.spaceId);
    const result = await db
      .insert(lists)
      .values({
        name:         data.name,
        spaceId:      data.spaceId,
        folderId:     data.folderId ?? null,
        color:        data.color ?? null,
        displayOrder: maxOrder + 1,
      })
      .returning();

    // Insert default statuses
    const listItem = result[0] as { id: string } | undefined;
    if (!listItem) throw new Error("Failed to create list");
    await db.insert(listStatuses).values(
      DEFAULT_STATUSES.map(s => ({ ...s, listId: listItem.id }))
    );

    return listItem as typeof lists.$inferSelect;
  },

  async update(id: string, data: UpdateListInput) {
    const [listItem] = await db
      .update(lists)
      .set({
        ...(data.name         !== undefined && { name:         data.name }),
        ...(data.color        !== undefined && { color:        data.color }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
      })
      .where(eq(lists.id, id))
      .returning();
    return listItem;
  },

  async delete(id: string) {
    // Soft-delete tasks inside
    await db.execute(sql`
      UPDATE tasks SET deleted_at = now() WHERE list_id = ${id}::uuid AND deleted_at IS NULL
    `);
    // Delete statuses then list (cascade should handle, but be explicit)
    await db.delete(listStatuses).where(eq(listStatuses.listId, id));
    await db.delete(lists).where(eq(lists.id, id));
  },

  async hasActiveTasks(id: string) {
    const result = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*) AS cnt FROM tasks
      WHERE list_id = ${id}::uuid AND deleted_at IS NULL
    `);
    return Number(result[0]?.cnt ?? 0) > 0;
  },

  // ── Statuses ──
  async findStatuses(listId: string) {
    return db
      .select()
      .from(listStatuses)
      .where(eq(listStatuses.listId, listId))
      .orderBy(asc(listStatuses.displayOrder));
  },

  async findStatusById(statusId: string) {
    return db.query.listStatuses.findFirst({
      where: eq(listStatuses.id, statusId),
    });
  },

  async getMaxStatusOrder(listId: string) {
    const result = await db
      .select({ max: sql<number>`COALESCE(MAX(display_order), 0)`.mapWith(Number) })
      .from(listStatuses)
      .where(eq(listStatuses.listId, listId));
    return result[0]?.max ?? 0;
  },

  async createStatus(listId: string, data: CreateStatusInput) {
    const maxOrder = await this.getMaxStatusOrder(listId);
    const [status] = await db
      .insert(listStatuses)
      .values({
        listId,
        name:         data.name,
        color:        data.color,
        type:         data.type,
        displayOrder: maxOrder + 1,
      })
      .returning();
    return status;
  },

  async updateStatus(statusId: string, data: UpdateStatusInput) {
    const [status] = await db
      .update(listStatuses)
      .set({
        ...(data.name  !== undefined && { name:  data.name }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.type  !== undefined && { type:  data.type }),
      })
      .where(eq(listStatuses.id, statusId))
      .returning();
    return status;
  },

  async deleteStatus(statusId: string) {
    await db.delete(listStatuses).where(eq(listStatuses.id, statusId));
  },

  async countTasksInStatus(statusId: string) {
    const result = await db.execute<{ cnt: number }>(sql`
      SELECT COUNT(*) AS cnt FROM tasks WHERE list_status_id = ${statusId}::uuid AND deleted_at IS NULL
    `);
    return Number(result[0]?.cnt ?? 0);
  },

  async reorderStatuses(listId: string, orderedIds: string[]) {
    const updates = orderedIds.map((statusId, idx) => {
      return db.execute(sql`
        UPDATE list_statuses SET display_order = ${idx + 1} 
        WHERE id = ${statusId}::uuid AND list_id = ${listId}::uuid
      `);
    });
    await Promise.all(updates);
  },
};
