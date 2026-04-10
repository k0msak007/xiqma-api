import { createHash } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { employees, roles, refreshTokens } from "@/db/schema/employees.schema.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmployeeRow {
  id:     string;
  name:   string;
  email:  string;
  role:   string;
  roleId: string | null;
}

export interface RefreshTokenRow {
  employeeId: string;
  expiresAt:  Date;
  revokedAt:  Date | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── Repository ────────────────────────────────────────────────────────────────

export const authRepository = {

  /**
   * หา employee ที่ email + is_active ตรง และ password ถูก (pgcrypto)
   * return null ถ้าไม่เจอหรือ password ผิด
   */
  async findByEmailAndPassword(email: string, password: string): Promise<EmployeeRow | null> {
    const rows = await db.execute(sql`
      SELECT id, name, email, role, role_id
      FROM   employees
      WHERE  email          = ${email}
        AND  is_active      = true
        AND  password_hash  IS NOT NULL
        AND  crypt(${password}, password_hash) = password_hash
      LIMIT  1
    `);

    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    return {
      id:     row.id     as string,
      name:   row.name   as string,
      email:  row.email  as string,
      role:   row.role   as string,
      roleId: (row.role_id ?? null) as string | null,
    };
  },

  /**
   * โหลด permissions array จาก roles table
   * return [] ถ้า roleId เป็น null หรือไม่เจอ role
   */
  async findPermissionsByRoleId(roleId: string | null): Promise<string[]> {
    if (!roleId) return [];

    const role = await db.query.roles.findFirst({
      where: eq(roles.id, roleId),
      columns: { permissions: true },
    });

    return (role?.permissions as string[]) ?? [];
  },

  /**
   * โหลด permissions ผ่าน employeeId (ใช้ตอน refresh token)
   */
  async findPermissionsByEmployeeId(employeeId: string): Promise<string[]> {
    const employee = await db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: { roleId: true },
    });

    return this.findPermissionsByRoleId(employee?.roleId ?? null);
  },

  /**
   * บันทึก refresh token (เก็บ SHA-256 hash เท่านั้น ไม่เก็บ plain text)
   */
  async saveRefreshToken(employeeId: string, token: string, expiresAt: Date): Promise<void> {
    await db.insert(refreshTokens).values({
      employeeId,
      tokenHash: hashToken(token),
      expiresAt,
    });
  },

  /**
   * หา refresh token row (ยังไม่ revoke) — return null ถ้าไม่เจอ
   */
  async findRefreshToken(token: string): Promise<RefreshTokenRow | null> {
    const row = await db.query.refreshTokens.findFirst({
      where: and(
        eq(refreshTokens.tokenHash, hashToken(token)),
        isNull(refreshTokens.revokedAt)
      ),
      columns: { employeeId: true, expiresAt: true, revokedAt: true },
    });

    return row ?? null;
  },

  /**
   * Revoke refresh token เดียว (logout)
   */
  async revokeRefreshToken(token: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, hashToken(token)),
          isNull(refreshTokens.revokedAt)
        )
      );
  },

  /**
   * Revoke ทุก refresh token ของ user (change password / force logout)
   */
  async revokeAllRefreshTokens(employeeId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.employeeId, employeeId),
          isNull(refreshTokens.revokedAt)
        )
      );
  },

  /**
   * ตรวจรหัสผ่านปัจจุบัน — return true ถ้าถูก
   */
  async passwordMatches(employeeId: string, password: string): Promise<boolean> {
    const rows = await db.execute(sql`
      SELECT 1
      FROM   employees
      WHERE  id            = ${employeeId}
        AND  password_hash IS NOT NULL
        AND  crypt(${password}, password_hash) = password_hash
      LIMIT  1
    `);

    return rows.length > 0;
  },

  /**
   * อัปเดต password hash ด้วย pgcrypto bcrypt
   */
  async updatePassword(employeeId: string, newPassword: string): Promise<void> {
    await db.execute(sql`
      UPDATE employees
      SET    password_hash = crypt(${newPassword}, gen_salt('bf')),
             updated_at    = now()
      WHERE  id = ${employeeId}
    `);
  },
};
