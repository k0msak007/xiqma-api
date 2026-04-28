import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import { validate } from "@/lib/validate.ts";
import {
  weeklyReportQuerySchema,
  generateWeeklyReportSchema,
  monthlyHrReportQuerySchema,
} from "@/validators/performance.validator.ts";
import {
  employeeReportQuerySchema,
  exportReportQuerySchema,
  aiSummaryBodySchema,
} from "@/validators/reports.validator.ts";
import { reportsService } from "@/services/performance.service.ts";
import { employeeReportService } from "@/services/reports.service.ts";
import { assertCanAccessEmployee } from "@/repositories/_scope.ts";

const idParamSchema = z.object({ id: z.string().uuid() });

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

// ─────────────────────────────────────────────────────────────────────────────
// Employee report (admin/manager) — JSON, Excel, AI summary
// ─────────────────────────────────────────────────────────────────────────────

const requireAdminOrManager = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin" && user.role !== "manager") {
    return c.json({ success: false, message: "ต้องเป็น admin หรือ manager เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

const requireAdmin = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ success: false, message: "ฟีเจอร์ AI สำหรับ admin เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

reports.get(
  "/employee/:id",
  validate("param", idParamSchema),
  validate("query", employeeReportQuerySchema),
  async (c) => {
    const forbidden = requireAdminOrManager(c);
    if (forbidden) return forbidden;
    const user = c.get("user");
    const { id } = c.req.valid("param" as never) as { id: string };
    const { from, to } = c.req.valid("query" as never) as { from: string; to: string };
    await assertCanAccessEmployee(id, user.role, user.userId);
    const data = await employeeReportService.getEmployeeReport(id, from, to);
    return c.json({ success: true, data, message: "ดึงรายงานสำเร็จ" });
  },
);

reports.get(
  "/employee/:id/export",
  validate("param", idParamSchema),
  validate("query", exportReportQuerySchema),
  async (c) => {
    const forbidden = requireAdminOrManager(c);
    if (forbidden) return forbidden;
    const user = c.get("user");
    const { id } = c.req.valid("param" as never) as { id: string };
    const { from, to } = c.req.valid("query" as never) as { from: string; to: string };
    await assertCanAccessEmployee(id, user.role, user.userId);
    const buf = await employeeReportService.exportEmployeeReportXlsx(id, from, to);
    const filename = `report-${id.slice(0, 8)}-${from}-to-${to}.xlsx`;
    // Convert Node Buffer → ArrayBuffer for Web Response
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Response(ab as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(buf.length),
      },
    });
  },
);

// ── Team report (one-click export & AI summary for everyone in scope) ───────
reports.get(
  "/team/export",
  validate("query", exportReportQuerySchema),
  async (c) => {
    const forbidden = requireAdminOrManager(c);
    if (forbidden) return forbidden;
    const user = c.get("user");
    const { from, to } = c.req.valid("query" as never) as { from: string; to: string };
    const buf = await employeeReportService.exportTeamReportXlsx(user.userId, user.role, from, to);
    const filename = `team-report-${from}-to-${to}.xlsx`;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Response(ab as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(buf.length),
      },
    });
  },
);

reports.post(
  "/team/ai-summary",
  validate("json", aiSummaryBodySchema),
  async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const user = c.get("user");
    const body = c.req.valid("json" as never) as {
      from: string; to: string; language: "th" | "en"; refresh: boolean;
    };
    const result = await employeeReportService.generateTeamAiSummary({
      callerUserId: user.userId,
      callerRole:   user.role,
      from:         body.from,
      to:           body.to,
      language:     body.language,
      refresh:      body.refresh,
    });
    return c.json({
      success: true,
      data:    result,
      message: result.cached ? "ใช้สรุปทีมจาก cache" : "สร้างสรุปทีมด้วย AI สำเร็จ",
    });
  },
);

reports.post(
  "/employee/:id/ai-summary",
  validate("param", idParamSchema),
  validate("json", aiSummaryBodySchema),
  async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const { id } = c.req.valid("param" as never) as { id: string };
    const body = c.req.valid("json" as never) as {
      from: string; to: string; language: "th" | "en"; refresh: boolean;
    };
    const result = await employeeReportService.generateEmployeeAiSummary({
      employeeId: id,
      from:       body.from,
      to:         body.to,
      language:   body.language,
      refresh:    body.refresh,
    });
    return c.json({
      success: true,
      data:    result,
      message: result.cached ? "ใช้สรุปจาก cache" : "สร้างสรุปด้วย AI สำเร็จ",
    });
  },
);

export const reportsRouter = reports;
