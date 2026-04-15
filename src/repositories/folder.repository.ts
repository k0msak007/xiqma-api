import { eq, and, sql, asc, desc } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { folders, lists } from "@/db/schema/workspace.schema.ts";
import type { CreateFolderInput, UpdateFolderInput, ListFoldersInput } from "@/validators/folder.validator.ts";

export const folderRepository = {
  async findAll(params: ListFoldersInput) {
    const { spaceId, includeArchived } = params;
    const rows = await db
      .select({
        id:           folders.id,
        name:         folders.name,
        spaceId:      folders.spaceId,
        color:        folders.color,
        displayOrder: folders.displayOrder,
        isArchived:   folders.isArchived,
        archivedAt:   folders.archivedAt,
        createdAt:    folders.createdAt,
        listCount:    sql<number>`(SELECT COUNT(*) FROM lists WHERE folder_id = ${folders.id})`.mapWith(Number),
      })
      .from(folders)
      .where(
        includeArchived
          ? eq(folders.spaceId, spaceId)
          : and(eq(folders.spaceId, spaceId), eq(folders.isArchived, false))
      )
      .orderBy(asc(folders.isArchived), asc(folders.displayOrder));
    return rows;
  },

  async findById(id: string) {
    return db.query.folders.findFirst({
      where: eq(folders.id, id),
    });
  },

  async getMaxDisplayOrder(spaceId: string) {
    const result = await db
      .select({ max: sql<number>`COALESCE(MAX(display_order), 0)`.mapWith(Number) })
      .from(folders)
      .where(eq(folders.spaceId, spaceId));
    return result[0]?.max ?? 0;
  },

  async create(data: CreateFolderInput) {
    const maxOrder = await this.getMaxDisplayOrder(data.spaceId);
    const [folder] = await db
      .insert(folders)
      .values({
        name:         data.name,
        spaceId:      data.spaceId,
        color:        data.color ?? null,
        displayOrder: maxOrder + 1,
      })
      .returning();
    return folder;
  },

  async update(id: string, data: UpdateFolderInput) {
    const [folder] = await db
      .update(folders)
      .set({
        ...(data.name         !== undefined && { name:         data.name }),
        ...(data.color        !== undefined && { color:        data.color }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
      })
      .where(eq(folders.id, id))
      .returning();
    return folder;
  },

  async archive(id: string) {
    const [folder] = await db
      .update(folders)
      .set({ isArchived: true, archivedAt: new Date() })
      .where(eq(folders.id, id))
      .returning();
    return folder;
  },

  async restore(id: string) {
    const [folder] = await db
      .update(folders)
      .set({ isArchived: false, archivedAt: null })
      .where(eq(folders.id, id))
      .returning();
    return folder;
  },

  async delete(id: string) {
    // Cascade: soft-delete tasks → delete list_statuses → delete lists → delete folder
    await db.execute(sql`
      UPDATE tasks SET deleted_at = now()
      WHERE list_id IN (SELECT id FROM lists WHERE folder_id = ${id}::uuid)
        AND deleted_at IS NULL
    `);
    await db.execute(sql`
      DELETE FROM list_statuses
      WHERE list_id IN (SELECT id FROM lists WHERE folder_id = ${id}::uuid)
    `);
    await db.delete(lists).where(eq(lists.folderId, id));
    await db.delete(folders).where(eq(folders.id, id));
  },
};
