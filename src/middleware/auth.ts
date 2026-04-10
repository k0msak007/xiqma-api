import { createMiddleware } from "hono/factory";
import { verifyAccessToken, type TokenPayload } from "@/lib/jwt.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// ── Type augmentation ─────────────────────────────────────────────────────────
// ทำให้ c.get('user') มี type ทุกที่

declare module "hono" {
  interface ContextVariableMap {
    user: TokenPayload;
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────

/**
 * ตรวจ JWT จาก Authorization header แล้ว inject user ลง context
 * ใช้บน route group ที่ต้องการ auth:
 *
 * @example
 * const tasks = new Hono().use(authMiddleware)
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new AppError(ErrorCode.MISSING_TOKEN, "กรุณาส่ง Authorization header", 401);
  }

  const token = authHeader.slice(7);
  const payload = await verifyAccessToken(token); // throw AppError ถ้า invalid/expired

  c.set("user", payload);
  await next();
});

// ── Permission guard ──────────────────────────────────────────────────────────

/**
 * ตรวจว่า user มี permission ที่ระบุ
 *
 * @example
 * .post('/', authMiddleware, requirePermission('manage_users'), handler)
 */
export function requirePermission(...permissions: string[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    const hasAll = permissions.every((p) => user.permissions.includes(p));

    if (!hasAll) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `ต้องมี permission: ${permissions.join(", ")}`,
        403
      );
    }
    await next();
  });
}

/**
 * ตรวจว่า user เป็น role ที่ระบุอย่างน้อย 1 อัน
 *
 * @example
 * .get('/team', authMiddleware, requireRole('manager', 'admin'), handler)
 */
export function requireRole(...roles: string[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");

    if (!roles.includes(user.role)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `ต้องเป็น role: ${roles.join(" หรือ ")}`,
        403
      );
    }
    await next();
  });
}
