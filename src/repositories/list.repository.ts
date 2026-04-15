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
    const rows = await db
      .select({
        id:           lists.id,
        name:         lists.name,
        spaceId:      lists.spaceId,
        folderId:     lists.folderId,
        color:        lists.color,
        displayOrder: lists.displayOrder,
        createdAt:    lists.createdAt,
        taskCount:    sql<number>`(SELECT COUNT(*) FROM tasks WHERE list_id = ${lists.id} AND deleted_at IS NULL)`.mapWith(Number),
        doneCount:    sql<number>`(
          SELECT COUNT(*) FROM tasks t
          JOIN list_statuses ls ON t.list_status_id = ls.id
          WHERE t.list_id = ${lists.id} AND ls.type IN ('done','closed') AND t.deleted_at IS NULL
        )`.mapWith(Number),
      })
      .from(lists)
      .where(
        folderId
          ? and(eq(lists.spaceId, spaceId), eq(lists.folderId, folderId))
          : eq(lists.spaceId, spaceId)
      )
      .orderBy(asc(lists.displayOrder));

    // Attach statuses to each list
    const listIds = rows.map(r => r.id);
    if (listIds.length === 0) return rows.map(r => ({ ...r, statuses: [] }));

    const statuses = await db
      .select()
      .from(listStatuses)
      .where(sql`list_id = ANY(${listIds}::uuid[])`)
      .orderBy(asc(listStatuses.displayOrder));

    return rows.map(row => ({
      ...row,
      statuses: statuses.filter(s => s.listId === row.id),
    }));
  },

  async findById(id: string) {
    return db.query.lists.findFirst({
      where: eq(lists.id, id),
      with: { statuses: { orderBy: asc(listStatuses.displayOrder) } },
    });
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
    const [list] = await db
      .insert(lists)
      .values({
        name:         data.name,
        spaceId:      data.spaceId,
        folderId:     data.folderId,
        color:        data.color,
        displayOrder: maxOrder + 1,
      })
      .returning();

    // Insert default statuses
    await db.insert(listStatuses).values(
      DEFAULT_STATUSES.map(s => ({ ...s, listId: list.id }))
    );

    return list;
  },

  async update(id: string, data: UpdateListInput) {
    const [list] = await db
      .update(lists)
      .set({
        ...(data.name         !== undefined && { name:         data.name }),
        ...(data.color        !== undefined && { color:        data.color }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
      })
      .where(eq(lists.id, id))
      .returning();
    return list;
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
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(listStatuses)
          .set({ displayOrder: i + 1 })
          .where(and(eq(listStatuses.id, orderedIds[i]), eq(listStatuses.listId, listId)));
      }
    });
  },
};
