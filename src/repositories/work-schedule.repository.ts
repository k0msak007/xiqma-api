import { eq, count } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { workSchedules, employeePerformanceConfig } from "@/db/schema/employees.schema.ts";
import type { CreateWorkScheduleInput, UpdateWorkScheduleInput } from "@/validators/work-schedule.validator.ts";

export const workScheduleRepository = {
  async findAll() {
    return db.query.workSchedules.findMany();
  },

  async findById(id: string) {
    return db.query.workSchedules.findFirst({
      where: eq(workSchedules.id, id),
    });
  },

  async findDefault() {
    return db.query.workSchedules.findFirst({
      where: eq(workSchedules.isDefault, true),
    });
  },

  async unsetDefault() {
    await db
      .update(workSchedules)
      .set({ isDefault: false })
      .where(eq(workSchedules.isDefault, true));
  },

  async countUsage(id: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(employeePerformanceConfig)
      .where(eq(employeePerformanceConfig.workScheduleId, id));
    return result[0]?.count ?? 0;
  },

  async create(data: CreateWorkScheduleInput) {
    const [schedule] = await db
      .insert(workSchedules)
      .values({
        name:          data.name,
        daysPerWeek:   String(data.daysPerWeek),
        hoursPerDay:   String(data.hoursPerDay),
        workDays:      data.workDays,
        workStartTime: data.workStartTime,
        workEndTime:   data.workEndTime,
        isDefault:     data.isDefault,
        // hoursPerWeek is GENERATED — never insert
      })
      .returning();
    return schedule;
  },

  async update(id: string, data: UpdateWorkScheduleInput) {
    const [schedule] = await db
      .update(workSchedules)
      .set({
        ...(data.name          !== undefined && { name:          data.name }),
        ...(data.daysPerWeek   !== undefined && { daysPerWeek:   String(data.daysPerWeek) }),
        ...(data.hoursPerDay   !== undefined && { hoursPerDay:   String(data.hoursPerDay) }),
        ...(data.workDays      !== undefined && { workDays:      data.workDays }),
        ...(data.workStartTime !== undefined && { workStartTime: data.workStartTime }),
        ...(data.workEndTime   !== undefined && { workEndTime:   data.workEndTime }),
        ...(data.isDefault     !== undefined && { isDefault:     data.isDefault }),
      })
      .where(eq(workSchedules.id, id))
      .returning();
    return schedule;
  },

  async delete(id: string) {
    await db.delete(workSchedules).where(eq(workSchedules.id, id));
  },
};
