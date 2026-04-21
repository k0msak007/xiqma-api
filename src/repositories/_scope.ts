import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

/**
 * คืน SQL fragment สำหรับจำกัด scope ให้ manager เห็นเฉพาะทีมตัวเอง
 * ใช้เป็น AND-clause — ต่อท้าย WHERE ที่มีเงื่อนไขอยู่แล้ว
 *
 * @param userRole   role ของ caller
 * @param userId     employees.id ของ caller
 * @param empIdExpr  SQL expression ที่อ้างถึง employee id column (เช่น "t.assignee_id", "wr.employee_id", "e.id")
 * @returns          SQL fragment string — คืน "" ถ้าไม่ต้อง scope (admin/hr)
 */
export function buildManagerScopeClause(
  userRole: string,
  userId: string,
  empIdExpr: string,
): string {
  if (userRole !== "manager") return "";
  return `AND ${empIdExpr} IN (SELECT id FROM employees WHERE manager_id = '${userId}'::uuid)`;
}

/**
 * ตรวจสอบว่า caller มีสิทธิ์เข้าถึงข้อมูลของ targetEmployeeId หรือไม่
 * - admin / hr      → ผ่าน
 * - self (target = userId) → ผ่าน
 * - manager         → ต้องเป็น direct report เท่านั้น
 * - employee        → ผ่านเฉพาะ self (อื่น ๆ โยน 403)
 *
 * โยน AppError(FORBIDDEN, 403) ถ้าไม่ผ่าน, NOT_FOUND(404) ถ้าไม่พบพนักงาน
 */
export async function assertCanAccessEmployee(
  targetEmployeeId: string,
  userRole: string,
  userId: string,
): Promise<void> {
  if (userRole === "admin" || userRole === "hr") return;
  if (targetEmployeeId === userId) return;

  if (userRole === "manager") {
    const rows = await db.execute<{ manager_id: string | null }>(sql`
      SELECT manager_id FROM employees WHERE id = ${targetEmployeeId}::uuid
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบพนักงาน id: ${targetEmployeeId}`, 404);
    }
    if (row.manager_id !== userId) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        "ไม่มีสิทธิ์ดูข้อมูลของพนักงานที่ไม่อยู่ในทีม",
        403,
      );
    }
    return;
  }

  // employee หรือ role อื่น
  throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ดูข้อมูลของพนักงานอื่น", 403);
}
