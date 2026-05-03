import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok } from "@/lib/response.ts";
import { botScheduleService } from "@/services/bot-schedule.service.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// Admin-only routes for managing recurring bot messages.

const idParamSchema = z.object({ id: z.string().uuid() });

const upsertBody = z.object({
  name:             z.string().min(1).max(120),
  description:      z.string().max(500).optional().nullable(),
  enabled:          z.boolean().optional(),
  sendTime:         z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  sendDays:         z.array(z.number().int().min(1).max(7)).min(1),
  sendDayOfMonth:   z.number().int().min(1).max(31).optional().nullable(),
  audienceType:     z.enum(["all", "role", "employee", "managers_and_admins"]),
  audienceValues:   z.array(z.string()).optional(),
  respectWorkDays:  z.boolean().optional(),
  mode:             z.enum(["static", "ai"]),
  titleTemplate:    z.string().min(1).max(200),
  bodyTemplate:     z.string().min(1).max(3000),
  contextKind:      z.enum(["today", "yesterday", "week", "none", "morning_briefing", "leave_reminder", "time_reminder", "weekly_hours"]),
  channels:         z.array(z.enum(["in_app", "line", "email"])).min(1),
  notifType:        z.string().optional(),
  deepLink:         z.string().max(200).optional().nullable(),
  sendIntervalType:    z.enum(["fixed", "interval"]).optional(),
  sendIntervalMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  sendWindowStart:     z.string().max(5).optional().nullable(),
  sendWindowEnd:       z.string().max(5).optional().nullable(),
  conditionKind:      z.enum(["none", "team_hours_below_target", "team_has_overdue", "hours_below_target", "hours_ok", "has_overdue_tasks", "has_due_today", "not_logged_today", "logged_less_than", "has_leave_today", "has_pending_leave"]).optional(),
  conditionParams:    z.record(z.any()).optional(),
});

const requireAdmin = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ success: false, message: "ต้องเป็น admin เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

export const botSchedulesRouter = new Hono()
  .use(authMiddleware)

  // GET /bot-schedules
  .get("/", async (c) => {
    const data = await botScheduleService.list();
    return ok(c, data, "ดึง bot schedules สำเร็จ");
  })

  // POST /bot-schedules
  .post("/", validate("json", upsertBody), async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const user = c.get("user");
    const body = c.req.valid("json");
    const created = await botScheduleService.create(body, user.userId);
    return ok(c, created, "สร้าง bot schedule สำเร็จ");
  })

  // GET /bot-schedules/:id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = await botScheduleService.findById(id);
    if (!data) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ schedule", 404);
    return ok(c, data, "ok");
  })

  // PUT /bot-schedules/:id
  .put("/:id", validate("param", idParamSchema), validate("json", upsertBody), async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const updated = await botScheduleService.update(id, body);
    return ok(c, updated, "อัปเดต schedule สำเร็จ");
  })

  // DELETE /bot-schedules/:id
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const { id } = c.req.valid("param");
    await botScheduleService.remove(id);
    return ok(c, null, "ลบสำเร็จ");
  })

  // POST /bot-schedules/:id/run-now — admin trigger immediately (force, ignores schedule)
  .post("/:id/run-now", validate("param", idParamSchema), async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const { id } = c.req.valid("param");
    const s = await botScheduleService.findById(id);
    if (!s) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ schedule", 404);
    const result = await botScheduleService.runSchedule(s, { force: true });
    return ok(c, result, "trigger สำเร็จ");
  });
