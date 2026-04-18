import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import { createPerformanceConfigSchema } from "@/validators/performance.validator.ts";
import { performanceConfigService } from "@/services/performance.service.ts";

const performanceConfig = new Hono().use(authMiddleware);

// GET /performance-config/me — ดู config ของตัวเอง
performanceConfig.get("/me", async (c) => {
  const user = c.get("user");
  const result = await performanceConfigService.getMe(user.userId);
  return c.json({ success: true, data: result, message: "ดึง performance config สำเร็จ" });
});

// GET /performance-config/:employee_id — ดู config ของพนักงานคนใดคนหนึ่ง (manager, admin)
performanceConfig.get("/:employee_id", async (c) => {
  const user = c.get("user");
  const { employee_id } = c.req.param();

  const result = await performanceConfigService.getByEmployee(
    employee_id,
    user.userId,
    user.role,
  );
  return c.json({ success: true, data: result, message: "ดึง performance config สำเร็จ" });
});

// POST /performance-config — สร้าง/อัปเดต config (upsert) สำหรับพนักงาน
performanceConfig.post("/", async (c) => {
  const user = c.get("user");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Request body ต้องเป็น JSON", 400);
  }

  const parsed = createPerformanceConfigSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field:   e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "ข้อมูลที่ส่งมาไม่ถูกต้อง", 400, details);
  }

  const result = await performanceConfigService.upsert(parsed.data, user.role);
  return c.json(
    { success: true, data: result, message: "บันทึก performance config สำเร็จ" },
    201,
  );
});

export const performanceConfigRouter = performanceConfig;
