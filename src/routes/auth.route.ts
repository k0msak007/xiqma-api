import { Hono } from "hono";
import { authService } from "@/services/auth.service.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import {
  loginSchema,
  refreshSchema,
  logoutSchema,
  changePasswordSchema,
} from "@/validators/auth.validator.ts";
import { ok, created } from "@/lib/response.ts";
import { validate } from "@/lib/validate";

export const authRouter = new Hono();

// ── POST /auth/login ───────────────────────────────────────────────────────────
// public — ไม่ต้องมี token

authRouter.post("/login", validate("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  const result = await authService.login(email, password);

  return ok(c, {
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_in: result.expiresIn,
    user: result.user,
  });
});

// ── POST /auth/refresh ─────────────────────────────────────────────────────────
// public — client ส่ง refresh_token มาขอ access_token ใหม่

authRouter.post("/refresh", validate("json", refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid("json");

  const result = await authService.refresh(refreshToken);

  return ok(c, {
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    expires_in: result.expiresIn,
  });
});

// ── POST /auth/logout ──────────────────────────────────────────────────────────
// public (ส่ง refresh_token มา revoke — ถ้าไม่มีก็ return 200 เหมือนกัน)

authRouter.post("/logout", validate("json", logoutSchema), async (c) => {
  const { refreshToken } = c.req.valid("json");

  await authService.logout(refreshToken);

  return ok(c, { message: "Logged out successfully" });
});

// ── GET /auth/me ───────────────────────────────────────────────────────────────
// protected — ดูข้อมูล user ปัจจุบันจาก token

authRouter.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");

  return ok(c, {
    id: user.userId,
    role: user.role,
    permissions: user.permissions,
  });
});

// ── PUT /employees/me/password ─────────────────────────────────────────────────
// protected — เปลี่ยนรหัสผ่านของตัวเอง
// หมายเหตุ: endpoint นี้อยู่ใน auth domain แม้ path จะขึ้นต้นด้วย /employees

authRouter.put(
  "/me/password",
  authMiddleware,
  validate("json", changePasswordSchema),
  async (c) => {
    const user = c.get("user");
    const { currentPassword, newPassword } = c.req.valid("json");

    await authService.changePassword(user.userId, currentPassword, newPassword);

    return ok(c, { message: "เปลี่ยนรหัสผ่านสำเร็จ" });
  },
);
