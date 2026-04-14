import { eq, and, count, asc } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { positions, employees } from "@/db/schema/employees.schema.ts";
import type { CreatePositionInput, UpdatePositionInput } from "@/validators/position.validator.ts";

export const positionRepository = {
  async findAll(department?: string) {
    const rows = await db
      .select({
        id:               positions.id,
        name:             positions.name,
        department:       positions.department,
        level:            positions.level,
        jobLevelCode:     positions.jobLevelCode,
        color:            positions.color,
        parentPositionId: positions.parentPositionId,
        isActive:         positions.isActive,
        createdAt:        positions.createdAt,
        updatedAt:        positions.updatedAt,
        employeeCount:    count(employees.id),
      })
      .from(positions)
      .leftJoin(
        employees,
        and(
          eq(employees.positionId, positions.id),
          eq(employees.isActive, true)
        )
      )
      .where(
        department
          ? and(eq(positions.isActive, true), eq(positions.department, department))
          : eq(positions.isActive, true)
      )
      .groupBy(positions.id)
      .orderBy(asc(positions.name));

    return rows;
  },

  async findById(id: string) {
    const position = await db.query.positions.findFirst({
      where: eq(positions.id, id),
      with: {
        employees: {
          where: eq(employees.isActive, true),
          columns: {
            id:           true,
            name:         true,
            employeeCode: true,
            email:        true,
            avatarUrl:    true,
          },
        },
      },
    });
    return position;
  },

  async countActiveEmployees(positionId: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(employees)
      .where(
        and(
          eq(employees.positionId, positionId),
          eq(employees.isActive, true)
        )
      );
    return result[0]?.count ?? 0;
  },

  async create(data: CreatePositionInput) {
    const [position] = await db
      .insert(positions)
      .values({
        name:             data.name,
        department:       data.department,
        level:            data.level,
        jobLevelCode:     data.jobLevelCode,
        color:            data.color ?? "#6b7280",
        parentPositionId: data.parentPositionId,
      })
      .returning();
    return position;
  },

  async update(id: string, data: UpdatePositionInput) {
    const [position] = await db
      .update(positions)
      .set({
        ...(data.name             !== undefined && { name:             data.name }),
        ...(data.department       !== undefined && { department:       data.department }),
        ...(data.level            !== undefined && { level:            data.level }),
        ...(data.jobLevelCode     !== undefined && { jobLevelCode:     data.jobLevelCode }),
        ...(data.color            !== undefined && { color:            data.color }),
        ...(data.parentPositionId !== undefined && { parentPositionId: data.parentPositionId }),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, id))
      .returning();
    return position;
  },

  async setInactive(id: string) {
    const [position] = await db
      .update(positions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();
    return position;
  },
};
