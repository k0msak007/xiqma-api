import { eq, ilike, and, or, count, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { employees, roles, positions } from "@/db/schema/employees.schema.ts";
import { leaveQuotas } from "@/db/schema/hr.schema.ts";
import type { CreateEmployeeInput, UpdateEmployeeInput, ListEmployeesInput } from "@/validators/employee.validator.ts";

export const employeeRepository = {
  async findAll(params: ListEmployeesInput & { managerUserId?: string }) {
    const { search, department, isActive, page, limit, managerUserId } = params;
    const offset = (page - 1) * limit;

    const conditions = [];

    // isActive เป็น optional — ถ้าไม่ระบุ ให้คืนทุก status
    if (isActive !== undefined) {
      conditions.push(eq(employees.isActive, isActive));
    }

    // จำกัดให้ manager เห็นเฉพาะทีมตัวเอง
    if (managerUserId) {
      conditions.push(eq(employees.managerId, managerUserId));
    }

    if (department) {
      conditions.push(eq(employees.department, department));
    }

    if (search) {
      conditions.push(
        or(
          ilike(employees.name, `%${search}%`),
          ilike(employees.employeeCode, `%${search}%`),
          ilike(employees.email, `%${search}%`)
        )!
      );
    }

    // and() with empty array returns undefined → no WHERE clause (ดึงทุก record)
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id:           employees.id,
          employeeCode: employees.employeeCode,
          name:         employees.name,
          email:        employees.email,
          avatarUrl:    employees.avatarUrl,
          role:         employees.role,
          department:   employees.department,
          isActive:     employees.isActive,
          createdAt:    employees.createdAt,
          managerId:    employees.managerId,
          roleName:     roles.name,
          positionName: positions.name,
        })
        .from(employees)
        .leftJoin(roles,     eq(employees.roleId,     roles.id))
        .leftJoin(positions, eq(employees.positionId, positions.id))
        .where(whereClause)
        .orderBy(asc(employees.name))
        .limit(limit)
        .offset(offset),

      db
        .select({ count: count() })
        .from(employees)
        .where(whereClause),
    ]);

    return { rows, total: totalResult[0]?.count ?? 0 };
  },

  async findById(id: string) {
    return db.query.employees.findFirst({
      where: eq(employees.id, id),
      with: {
        role:     true,
        position: true,
      },
    });
  },

  async findByEmployeeCode(employeeCode: string) {
    return db.query.employees.findFirst({
      where: eq(employees.employeeCode, employeeCode),
    });
  },

  async create(data: CreateEmployeeInput) {
    // Use pgcrypto for password hashing
    const [employee] = await db.execute(sql`
      INSERT INTO employees (
        employee_code, name, email, password_hash,
        role, role_id, position_id, manager_id,
        department,
        leave_quota_annual, leave_quota_sick, leave_quota_personal,
        is_active
      ) VALUES (
        ${data.employeeCode},
        ${data.name},
        ${data.email ?? null},
        crypt(${data.password}, gen_salt('bf')),
        ${data.role}::"user_role",
        ${data.roleId ?? null}::uuid,
        ${data.positionId ?? null}::uuid,
        ${data.managerId ?? null}::uuid,
        ${data.department ?? null},
        ${data.leaveQuotaAnnual},
        ${data.leaveQuotaSick},
        ${data.leaveQuotaPersonal},
        false
      )
      RETURNING
        id, employee_code AS "employeeCode", name, email,
        avatar_url AS "avatarUrl", role, role_id AS "roleId",
        position_id AS "positionId", manager_id AS "managerId",
        department,
        leave_quota_annual AS "leaveQuotaAnnual",
        leave_quota_sick AS "leaveQuotaSick",
        leave_quota_personal AS "leaveQuotaPersonal",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `) as Array<{ id: string; [key: string]: unknown }>;

    // Insert leave_quotas rows for the current year (annual / sick / personal)
    const currentYear = new Date().getFullYear();
    const emp = (employee as unknown as Array<{ id: string }>)?.[0];
    if (!emp) throw new Error("Failed to create employee");
    await db.insert(leaveQuotas).values([
      {
        employeeId: emp.id,
        year:       currentYear,
        leaveType:  "annual",
        quotaDays:  data.leaveQuotaAnnual,
        usedDays:   0,
      },
      {
        employeeId: emp.id,
        year:       currentYear,
        leaveType:  "sick",
        quotaDays:  data.leaveQuotaSick,
        usedDays:   0,
      },
      {
        employeeId: emp.id,
        year:       currentYear,
        leaveType:  "personal",
        quotaDays:  data.leaveQuotaPersonal,
        usedDays:   0,
      },
    ]);

    return emp as typeof employees.$inferSelect;
  },

  async update(id: string, data: UpdateEmployeeInput) {
    const [employee] = await db
      .update(employees)
      .set({
        ...(data.name       !== undefined && { name:       data.name }),
        ...(data.email      !== undefined && { email:      data.email }),
        ...(data.roleId     !== undefined && { roleId:     data.roleId }),
        ...(data.positionId !== undefined && { positionId: data.positionId }),
        ...(data.managerId  !== undefined && { managerId:  data.managerId }),
        ...(data.department !== undefined && { department: data.department }),
        ...(data.isActive   !== undefined && { isActive:   data.isActive }),
        updatedAt: new Date(),
      })
      .where(eq(employees.id, id))
      .returning();
    return employee;
  },

  async countActiveAdmins() {
    const result = await db
      .select({ count: count() })
      .from(employees)
      .where(and(eq(employees.role, "admin"), eq(employees.isActive, true)));
    return result[0]?.count ?? 0;
  },

  async deactivate(id: string) {
    const [employee] = await db
      .update(employees)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    return employee;
  },

  async updateAvatar(id: string, avatarUrl: string) {
    const [employee] = await db
      .update(employees)
      .set({ avatarUrl, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    return employee;
  },

  async updatePassword(id: string, newPasswordHash: string) {
    const [employee] = await db
      .update(employees)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    return employee;
  },

  async verifyPassword(id: string, password: string) {
    const result = await db.execute<{ verified: boolean }>(sql`
      SELECT (crypt(${password}, password_hash) = password_hash) AS verified
      FROM employees
      WHERE id = ${id}::uuid
    `);
    return result[0]?.verified ?? false;
  },
};
