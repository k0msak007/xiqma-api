import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import {
  analyticsPerformanceQuerySchema,
  velocityQuerySchema,
  efficiencyQuerySchema,
} from "@/validators/performance.validator.ts";
import { analyticsService } from "@/services/performance.service.ts";

const analytics = new Hono().use(authMiddleware);

// GET /analytics/performance?employee_id=&period=&start=&end=
// ดูสรุปผลงาน — งานที่ได้รับ / กำลังทำ / เสร็จแล้ว / points
analytics.get("/performance", async (c) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const parsed = analyticsPerformanceQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "query params ไม่ถูกต้อง", 400, details);
  }

  const result = await analyticsService.getPerformanceSummary(
    parsed.data,
    user.userId,
    user.role,
  );
  return c.json({ success: true, data: result, message: "ดึงข้อมูล performance สำเร็จ" });
});

// GET /analytics/velocity?employee_id=&weeks=
// ดู velocity ย้อนหลัง N สัปดาห์ — ใช้ render กราฟแนวโน้ม
analytics.get("/velocity", async (c) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const parsed = velocityQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "query params ไม่ถูกต้อง", 400, details);
  }

  const result = await analyticsService.getVelocity(parsed.data, user.userId, user.role);
  return c.json({ success: true, data: result, message: "ดึงข้อมูล velocity สำเร็จ" });
});

// GET /analytics/efficiency?period=&employee_id=
// วิเคราะห์ความแม่นยำในการ estimate เวลาของแต่ละคน (manager, admin เท่านั้น)
analytics.get("/efficiency", async (c) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const parsed = efficiencyQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "query params ไม่ถูกต้อง", 400, details);
  }

  const result = await analyticsService.getEfficiency(parsed.data, user.userId, user.role);
  return c.json({ success: true, data: result, message: "ดึงข้อมูล efficiency สำเร็จ" });
});

// GET /analytics/bottleneck
// หา status columns ที่ task ค้างอยู่นานที่สุด (manager, admin เท่านั้น)
analytics.get("/bottleneck", async (c) => {
  const user = c.get("user");
  const result = await analyticsService.getBottleneck(user.role);
  return c.json({ success: true, data: result, message: "ดึงข้อมูล bottleneck สำเร็จ" });
});

// GET /analytics/team-workload
// ดู workload ของแต่ละคนในทีม (manager, admin เท่านั้น)
analytics.get("/team-workload", async (c) => {
  const user = c.get("user");
  const result = await analyticsService.getTeamWorkload(user.userId, user.role);
  return c.json({ success: true, data: result, message: "ดึงข้อมูล team workload สำเร็จ" });
});

export const analyticsRouter = analytics;
