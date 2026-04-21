import { eq, and, gte, lt, sql, asc, desc, type SQL } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { leaveRequests, leaveQuotas, attendanceLogs } from "@/db/schema/hr.schema.ts";
import { employees } from "@/db/schema/employees.schema.ts";
import { companyHolidays } from "@/db/schema/hr.schema.ts";

// ── Leave Request Repository ───────────────────────────────────────────────────

export const leaveRepository = {
  async findAll(params: {
    employeeId: string | undefined;
    status: string | undefined;
    year: number | undefined;
    month: number | undefined;
    page: number | undefined;
    limit: number | undefined;
    managerUserId?: string | undefined;
  }) {
    const { employeeId, status, year, month, page = 1, limit = 20, managerUserId } = params;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (employeeId) conditions.push(eq(leaveRequests.employeeId, employeeId));
    if (managerUserId) {
      conditions.push(
        sql`${leaveRequests.employeeId} IN (SELECT id FROM employees WHERE manager_id = ${managerUserId}::uuid)`,
      );
    }
    if (status) conditions.push(eq(leaveRequests.status, status as any));
    if (year) conditions.push(sql`EXTRACT(YEAR FROM ${leaveRequests.startDate}) = ${year}`);
    if (month) conditions.push(sql`EXTRACT(MONTH FROM ${leaveRequests.startDate}) = ${month}`);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: leaveRequests.id,
        displayId: leaveRequests.displayId,
        employeeId: leaveRequests.employeeId,
        employeeName: employees.name,
        leaveType: leaveRequests.leaveType,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .leftJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .where(where)
      .orderBy(desc(leaveRequests.createdAt))
      .limit(limit)
      .offset(offset);

    const countRows = await db
      .select({ count: sql`count(*)` })
      .from(leaveRequests)
      .where(where);
    const total = Number(countRows[0]?.count || 0);

    return { rows, total, page, limit };
  },

  async findById(id: string) {
    const [row] = await db
      .select({
        id: leaveRequests.id,
        displayId: leaveRequests.displayId,
        employeeId: leaveRequests.employeeId,
        employeeName: employees.name,
        employeeEmail: employees.email,
        approvedBy: leaveRequests.approvedBy,
        reviewerName: sql<string>`r.name`,
        leaveType: leaveRequests.leaveType,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
        reason: leaveRequests.reason,
        medicalCertificateUrl: leaveRequests.medicalCertificateUrl,
        status: leaveRequests.status,
        reviewedAt: leaveRequests.reviewedAt,
        rejectReason: leaveRequests.rejectReason,
        createdAt: leaveRequests.createdAt,
        updatedAt: leaveRequests.updatedAt,
      })
      .from(leaveRequests)
      .leftJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .leftJoin(employees as any, eq(leaveRequests.approvedBy, sql`r.id`))
      .where(eq(leaveRequests.id, id));
    return row ?? null;
  },

  async create(data: {
    employeeId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    totalDays: number;
    reason?: string;
    medicalCertificateUrl?: string;
  }) {
    // Generate display_id: LR-000001
    const seqResult = await db.execute<{ nextval: number }>(sql`SELECT nextval('leave_request_seq')`);
    const nextVal = seqResult[0]?.nextval || 1;
    const displayId = `LR-${String(nextVal).padStart(6, '0')}`;

    const [row] = await db
      .insert(leaveRequests)
      .values({
        employeeId: data.employeeId,
        leaveType: data.leaveType as any,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: data.totalDays,
        reason: data.reason ?? null,
        medicalCertificateUrl: data.medicalCertificateUrl ?? null,
        status: "pending",
      })
      .returning();

    return row;
  },

  async updateStatus(
    id: string,
    data: {
      status: string;
      approvedBy?: string;
      rejectReason?: string;
    }
  ) {
    const updates: Record<string, unknown> = {
      status: data.status,
      updatedAt: new Date(),
    };

    if (data.status === "approved") {
      updates.approvedBy = data.approvedBy;
      updates.reviewedAt = new Date();
    } else if (data.status === "rejected") {
      updates.approvedBy = data.approvedBy;
      updates.reviewedAt = new Date();
      updates.rejectReason = data.rejectReason;
    }

    const [row] = await db
      .update(leaveRequests)
      .set(updates)
      .where(eq(leaveRequests.id, id))
      .returning();

    return row ?? null;
  },

  async cancel(id: string, isAdmin: boolean) {
    // Get current status
    const [existing] = await db
      .select({ status: leaveRequests.status })
      .from(leaveRequests)
      .where(eq(leaveRequests.id, id));

    if (!existing) return null;

    // Only pending can be cancelled by employee, or admin can cancel approved
    if (existing.status !== "pending" && !isAdmin) {
      throw new Error("Cannot cancel leave request");
    }

    const [row] = await db
      .update(leaveRequests)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(leaveRequests.id, id))
      .returning();

    return row ?? null;
  },
};

// ── Leave Quota Repository ─────────────────────────────────────────────────────

export const leaveQuotaRepository = {
  async findByEmployee(employeeId: string, year: number) {
    return db
      .select({
        id: leaveQuotas.id,
        employeeId: leaveQuotas.employeeId,
        year: leaveQuotas.year,
        leaveType: leaveQuotas.leaveType,
        quotaDays: leaveQuotas.quotaDays,
        usedDays: leaveQuotas.usedDays,
        remainingDays: leaveQuotas.remainingDays,
      })
      .from(leaveQuotas)
      .where(and(
        eq(leaveQuotas.employeeId, employeeId),
        eq(leaveQuotas.year, year)
      ));
  },

  async findAll(params: { employeeId?: string; year?: number }) {
    const conditions = [];
    if (params.employeeId) conditions.push(eq(leaveQuotas.employeeId, params.employeeId));
    if (params.year) conditions.push(eq(leaveQuotas.year, params.year));

    return db
      .select({
        id: leaveQuotas.id,
        employeeId: leaveQuotas.employeeId,
        employeeName: employees.name,
        employeeCode: employees.employeeCode,
        year: leaveQuotas.year,
        leaveType: leaveQuotas.leaveType,
        quotaDays: leaveQuotas.quotaDays,
        usedDays: leaveQuotas.usedDays,
        remainingDays: leaveQuotas.remainingDays,
      })
      .from(leaveQuotas)
      .leftJoin(employees, eq(leaveQuotas.employeeId, employees.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(employees.name));
  },

  async upsert(employeeId: string, year: number, leaveType: string, quotaDays: number) {
    const [row] = await db
      .insert(leaveQuotas)
      .values({
        employeeId,
        year,
        leaveType: leaveType as any,
        quotaDays,
        usedDays: 0,
      })
      .onConflictDoUpdate({
        target: [leaveQuotas.employeeId, leaveQuotas.year, leaveQuotas.leaveType],
        set: { quotaDays, updatedAt: new Date() },
      })
      .returning();
    return row;
  },

  async incrementUsedDays(employeeId: string, year: number, leaveType: string, days: number) {
    const [row] = await db
      .update(leaveQuotas)
      .set({
        usedDays: sql`used_days + ${days}`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(leaveQuotas.employeeId, employeeId),
        eq(leaveQuotas.year, year),
        eq(leaveQuotas.leaveType, leaveType as any)
      ))
      .returning();
    return row ?? null;
  },

  async decrementUsedDays(employeeId: string, year: number, leaveType: string, days: number) {
    const [row] = await db
      .update(leaveQuotas)
      .set({
        usedDays: sql`GREATEST(0, used_days - ${days})`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(leaveQuotas.employeeId, employeeId),
        eq(leaveQuotas.year, year),
        eq(leaveQuotas.leaveType, leaveType as any)
      ))
      .returning();
    return row ?? null;
  },
};

// ── Attendance Repository ─────────────────────────────────────────────────────

export const attendanceRepository = {
  async findByEmployeeAndDate(employeeId: string, workDate: string) {
    const [row] = await db
      .select()
      .from(attendanceLogs)
      .where(and(
        eq(attendanceLogs.employeeId, employeeId),
        eq(attendanceLogs.workDate, workDate as any)
      ));
    return row ?? null;
  },

  async checkIn(employeeId: string, workDate: string, isLate: boolean) {
    const [row] = await db
      .insert(attendanceLogs)
      .values({
        employeeId,
        workDate,
        checkIn: new Date(),
        status: isLate ? "late" : "present",
      })
      .onConflictDoUpdate({
        target: [attendanceLogs.employeeId, attendanceLogs.workDate],
        set: {
          checkIn: new Date(),
          status: isLate ? "late" : "present",
        },
      })
      .returning();
    return row;
  },

  async checkOut(employeeId: string, workDate: string) {
    const [row] = await db
      .update(attendanceLogs)
      .set({
        checkOut: new Date(),
      })
      .where(and(
        eq(attendanceLogs.employeeId, employeeId),
        eq(attendanceLogs.workDate, workDate as any)
      ))
      .returning();

    if (!row) return null;

    // Calculate total hours
    if (row.checkIn && row.checkOut) {
      const hours = (row.checkOut.getTime() - row.checkIn.getTime()) / (1000 * 60 * 60);
      return { ...row, totalHours: Math.round(hours * 100) / 100 };
    }

    return row;
  },

  async getTodayStatus(employeeId: string) {
    const today = new Date().toISOString().split("T")[0];
    const [row] = await db
      .select()
      .from(attendanceLogs)
      .where(and(
        eq(attendanceLogs.employeeId, employeeId),
        eq(attendanceLogs.workDate, today as any)
      ));
    return row ?? null;
  },

  async findAll(params: { employeeId?: string; month?: number; year?: number }) {
    const conditions: SQL[] = [];

    if (params.employeeId) {
      conditions.push(eq(attendanceLogs.employeeId, params.employeeId));
    }

    if (params.year && params.month) {
      const startDate = `${params.year}-${String(params.month).padStart(2, "0")}-01`;
      const endDate = params.month === 12 
        ? `${params.year + 1}-01-01`
        : `${params.year}-${String(params.month + 1).padStart(2, "0")}-01`;
      conditions.push(gte(attendanceLogs.workDate, startDate as any));
      conditions.push(lt(attendanceLogs.workDate, endDate as any));
    } else if (params.year) {
      const startDate = `${params.year}-01-01`;
      const endDate = `${params.year + 1}-01-01`;
      conditions.push(gte(attendanceLogs.workDate, startDate as any));
      conditions.push(lt(attendanceLogs.workDate, endDate as any));
    }

    const rows = await db
      .select({
        id: attendanceLogs.id,
        employeeId: attendanceLogs.employeeId,
        employeeName: employees.name,
        workDate: attendanceLogs.workDate,
        checkIn: attendanceLogs.checkIn,
        checkOut: attendanceLogs.checkOut,
        status: attendanceLogs.status,
        note: attendanceLogs.note,
      })
      .from(attendanceLogs)
      .leftJoin(employees, eq(attendanceLogs.employeeId, employees.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(attendanceLogs.workDate));

    return rows;
  },

  async findByManager(managerId: string, date: string) {
    const rows = await db
      .select({
        id: employees.id,
        name: employees.name,
        avatarUrl: employees.avatarUrl,
        workDate: attendanceLogs.workDate,
        checkIn: attendanceLogs.checkIn,
        checkOut: attendanceLogs.checkOut,
        status: attendanceLogs.status,
        note: attendanceLogs.note,
      })
      .from(employees)
      .leftJoin(attendanceLogs, and(
        eq(attendanceLogs.employeeId, employees.id),
        eq(attendanceLogs.workDate, date as any)
      ))
      .where(eq(employees.managerId, managerId));

    return rows;
  },
};

// ── Working Days Helper ───────────────────────────────────────────────────────

export function calculateWorkingDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let workingDays = 0;

  const current = new Date(start);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      // Check if it's a company holiday
      // For now, just count weekdays
      workingDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}