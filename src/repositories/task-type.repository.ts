import { eq, asc, count } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { taskTypes } from "@/db/schema/workspace.schema.ts";
import { tasks } from "@/db/schema/tasks.schema.ts";
import type { CreateTaskTypeInput, UpdateTaskTypeInput } from "@/validators/task-type.validator.ts";

export const taskTypeRepository = {
  async findAll() {
    return db.query.taskTypes.findMany({
      orderBy: [asc(taskTypes.name)],
    });
  },

  async findById(id: string) {
    return db.query.taskTypes.findFirst({
      where: eq(taskTypes.id, id),
    });
  },

  async countUsage(id: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.taskTypeId, id));
    return result[0]?.count ?? 0;
  },

  async create(data: CreateTaskTypeInput) {
    const [taskType] = await db
      .insert(taskTypes)
      .values({
        name:            data.name,
        description:     data.description ?? null,
        color:           data.color ?? "#6b7280",
        category:        data.category ?? null,
        countsForPoints: data.countsForPoints ?? true,
        fixedPoints:     data.fixedPoints ?? null,
      })
      .returning();
    return taskType;
  },

  async update(id: string, data: UpdateTaskTypeInput) {
    const [taskType] = await db
      .update(taskTypes)
      .set({
        ...(data.name            !== undefined && { name:            data.name }),
        ...(data.description     !== undefined && { description:     data.description }),
        ...(data.color           !== undefined && { color:           data.color }),
        ...(data.category        !== undefined && { category:        data.category }),
        ...(data.countsForPoints !== undefined && { countsForPoints: data.countsForPoints }),
        ...(data.fixedPoints     !== undefined && { fixedPoints:     data.fixedPoints }),
      })
      .where(eq(taskTypes.id, id))
      .returning();
    return taskType;
  },

  async delete(id: string) {
    await db.delete(taskTypes).where(eq(taskTypes.id, id));
  },
};
