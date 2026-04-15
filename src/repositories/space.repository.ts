import { eq, sql, and } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { spaces, spaceMembers } from "@/db/schema/workspace.schema.ts";
import type { CreateSpaceInput, UpdateSpaceInput } from "@/validators/space.validator.ts";

export const spaceRepository = {
  async findAll(userId: string, isAdmin: boolean) {
    // Admin sees all, others see only spaces they're member of
    const rows = await db
      .select({
        id:           spaces.id,
        name:         spaces.name,
        color:        spaces.color,
        icon:         spaces.icon,
        displayOrder: spaces.displayOrder,
        createdAt:    spaces.createdAt,
        memberCount:  sql<number>`(SELECT COUNT(*) FROM space_members WHERE space_id = ${spaces.id})`.mapWith(Number),
        listCount:    sql<number>`(SELECT COUNT(*) FROM lists WHERE space_id = ${spaces.id})`.mapWith(Number),
      })
      .from(spaces)
      .where(
        isAdmin
          ? undefined
          : sql`EXISTS (SELECT 1 FROM space_members WHERE space_id = ${spaces.id} AND employee_id = ${userId}::uuid)`
      )
      .orderBy(spaces.displayOrder);
    return rows;
  },

  async findById(id: string) {
    const space = await db.query.spaces.findFirst({
      where: eq(spaces.id, id),
      with: {
        members: {
          with: { employee: true },
        },
      },
    });
    return space;
  },

  async isMember(spaceId: string, employeeId: string) {
    const row = await db.query.spaceMembers.findFirst({
      where: and(
        eq(spaceMembers.spaceId, spaceId),
        eq(spaceMembers.employeeId, employeeId)
      ),
    });
    return !!row;
  },

  async getMaxDisplayOrder() {
    const result = await db
      .select({ max: sql<number>`COALESCE(MAX(display_order), 0)`.mapWith(Number) })
      .from(spaces);
    return result[0]?.max ?? 0;
  },

  async create(data: CreateSpaceInput, creatorId: string) {
    const maxOrder = await this.getMaxDisplayOrder();
    const [space] = await db
      .insert(spaces)
      .values({
        name:         data.name,
        color:        data.color ?? "#3b82f6",
        icon:         data.icon ?? null,
        displayOrder: maxOrder + 1,
      })
      .returning();

    // Insert creator + all memberIds (ON CONFLICT DO NOTHING via unique constraint)
    const memberIds = Array.from(new Set([creatorId, ...(data.memberIds ?? [])]));
    if (memberIds.length > 0) {
      const sp = space as { id: string } | undefined;
      if (!sp) throw new Error("Failed to create space");
      await db
        .insert(spaceMembers)
        .values(memberIds.map(eid => ({ spaceId: sp.id, employeeId: eid })))
        .onConflictDoNothing();
    }

    return space as typeof spaces.$inferSelect;
  },

  async update(id: string, data: UpdateSpaceInput) {
    const [space] = await db
      .update(spaces)
      .set({
        ...(data.name         !== undefined && { name:         data.name }),
        ...(data.color        !== undefined && { color:        data.color }),
        ...(data.icon         !== undefined && { icon:         data.icon ?? null }),
        ...(data.displayOrder !== undefined && { displayOrder: data.displayOrder }),
      })
      .where(eq(spaces.id, id))
      .returning();
    return space;
  },

  async delete(id: string) {
    // Cascade: tasks (soft) → list_statuses → lists → folders → space_members → space
    await db.execute(sql`
      UPDATE tasks SET deleted_at = now()
      WHERE list_id IN (SELECT id FROM lists WHERE space_id = ${id}::uuid)
        AND deleted_at IS NULL
    `);
    await db.execute(sql`
      DELETE FROM list_statuses
      WHERE list_id IN (SELECT id FROM lists WHERE space_id = ${id}::uuid)
    `);
    await db.execute(sql`DELETE FROM lists WHERE space_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM folders WHERE space_id = ${id}::uuid`);
    await db.delete(spaceMembers).where(eq(spaceMembers.spaceId, id));
    await db.delete(spaces).where(eq(spaces.id, id));
  },

  async hasActiveContent(id: string) {
    // Check if there are any non-archived folders or lists
    const result = await db.execute<{ cnt: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM folders WHERE space_id = ${id}::uuid AND is_archived = false) +
        (SELECT COUNT(*) FROM lists   WHERE space_id = ${id}::uuid) AS cnt
    `);
    return (result[0]?.cnt ?? 0) > 0;
  },

  async addMembers(spaceId: string, employeeIds: string[]) {
    await db
      .insert(spaceMembers)
      .values(employeeIds.map(eid => ({ spaceId, employeeId: eid })))
      .onConflictDoNothing();
  },

  async removeMember(spaceId: string, employeeId: string) {
    await db
      .delete(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.employeeId, employeeId)
        )
      );
  },
};
