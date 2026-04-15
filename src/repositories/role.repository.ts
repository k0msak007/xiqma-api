import { eq, asc, count } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { roles, employees } from "@/db/schema/employees.schema.ts";
import type { CreateRoleInput, UpdateRoleInput } from "@/validators/role.validator.ts";

export const roleRepository = {
  async findAll() {
    return db.query.roles.findMany({
      orderBy: [asc(roles.name)],
    });
  },

  async findById(id: string) {
    return db.query.roles.findFirst({
      where: eq(roles.id, id),
    });
  },

  async findByName(name: string) {
    return db.query.roles.findFirst({
      where: eq(roles.name, name),
    });
  },

  async countEmployeesByRoleId(roleId: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(employees)
      .where(eq(employees.roleId, roleId));
    return result[0]?.count ?? 0;
  },

  async create(data: CreateRoleInput) {
    const [role] = await db
      .insert(roles)
      .values({
        name:        data.name,
        description: data.description ?? null,
        color:       data.color ?? "#6b7280",
        permissions: data.permissions,
      })
      .returning();
    return role;
  },

  async update(id: string, data: UpdateRoleInput) {
    const [role] = await db
      .update(roles)
      .set({
        ...(data.name        !== undefined && { name:        data.name }),
        ...(data.description !== undefined && { description: data.description ?? null }),
        ...(data.color       !== undefined && { color:       data.color }),
        ...(data.permissions !== undefined && { permissions: data.permissions }),
      })
      .where(eq(roles.id, id))
      .returning();
    return role;
  },

  async delete(id: string) {
    await db.delete(roles).where(eq(roles.id, id));
  },
};
