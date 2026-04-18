import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import {
  weeklyReportQuerySchema,
  generateWeeklyReportSchema,
  monthlyHrReportQuerySchema,
} from "@/validators/performance.validator.ts";
import { reportsService } from "@/services/performance.service.ts";

const reports = new Hono().use(authMiddleware);

// GET /reports/weekly?employee_id=&week=
// ดูรายงานประจำสัปดาห์ — rank, actual vs expected points
reports.get("/weekly", async (c) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const parsed = weeklyReportQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "query params ไม่ถูกต้อง", 400, details);
  }

  const result = await reportsService.getWeeklyReport(parsed.data, user.userId, user.role);

  if (!result) {
    return c.json({
      success: true,
      data: null,
      message: "ยังไม่มีรายงานสำหรับสัปดาห์นี้ — ลอง generate ก่อน",
    });
  }

  return c.json({ success: true, data: result, message: "ดึงรายงานสัปดาห์สำเร็จ" });
});

// GET /reports/weekly/team?week=
// ดูรายงานสัปดาห์ของทีม เรียงตาม rank (manager, admin เท่านั้น)
reports.get("/weekly/team", async (c) => {
  const user = c.get("user");
  const { week } = c.req.query();

  const teamParams = week ? { week } : {};
  const result = await reportsService.getWeeklyTeamReport(teamParams, user.userId, user.role);
  return c.json({ success: true, data: result, message: "ดึงรายงานสัปดาห์ของทีมสำเร็จ" });
});

// POST /reports/weekly/generate
// trigger สร้างรายงานสัปดาห์ด้วยตนเอง — admin เท่านั้น
reports.post("/weekly/generate", async (c) => {
  const user = c.get("user");

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Request body ต้องเป็น JSON หรือว่างเปล่า", 400);
  }

  const parsed = generateWeeklyReportSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "ข้อมูลที่ส่งมาไม่ถูกต้อง", 400, details);
  }

  const result = await reportsService.generateWeeklyReport(parsed.data, user.role);
  return c.json(
    {
      success: true,
      data: result,
      message: `สร้างรายงานสัปดาห์สำเร็จ ${result.generated} รายการ`,
    },
    201,
  );
});

// GET /reports/monthly-hr?employee_id=&year=&month=
// ดูรายงาน HR รายเดือน — วันลา, วันเข้างาน, late count (HR, admin)
reports.get("/monthly-hr", async (c) => {
  const user = c.get("user");
  const rawQuery = c.req.query();

  const parsed = monthlyHrReportQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message,
    }));
    throw new AppError(ErrorCode.VALIDATION_ERROR, "query params ไม่ถูกต้อง", 400, details);
  }

  const result = await reportsService.getMonthlyHrReport(parsed.data, user.userId, user.role);
  return c.json({ success: true, data: result, message: "ดึงรายงาน HR รายเดือนสำเร็จ" });
});

export const reportsRouter = reports;
