import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok, paginate } from "@/lib/response.ts";
import { notificationService } from "@/services/notification.service.ts";
import { listNotificationsSchema } from "@/validators/profile.validator.ts";

const idParamSchema = z.object({
  id: z.string().uuid("id ต้องเป็น UUID"),
});

const updatePrefsBody = z.object({
  items: z.array(z.object({
    eventType: z.string().min(1),
    channel:   z.enum(["in_app", "line", "email"]),
    enabled:   z.boolean(),
  })).min(1),
});

const quietHoursBody = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/),
});

export const notificationsRouter = new Hono()
  .use(authMiddleware)

  // GET /notifications?unread=&page=&limit=
  .get("/", validate("query", listNotificationsSchema), async (c) => {
    const user = c.get("user");
    const query = c.req.valid("query");
    const { rows, total } = await notificationService.list({
      employeeId: user.userId,
      ...(query.unread !== undefined && { unread: query.unread }),
      page:       query.page,
      limit:      query.limit,
    });
    const { buildMeta } = paginate(c);
    return ok(c, rows, "ดึงข้อมูล notification สำเร็จ", buildMeta(total));
  })

  // PATCH /notifications/read-all
  .patch("/read-all", async (c) => {
    const user = c.get("user");
    const result = await notificationService.markAllRead(user.userId);
    return ok(c, result, "mark ทุก notification ว่าอ่านแล้วสำเร็จ");
  })

  // PATCH /notifications/:id/read
  .patch("/:id/read", validate("param", idParamSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const updated = await notificationService.markRead(id, user.userId);
    return ok(c, updated, "mark notification ว่าอ่านแล้วสำเร็จ");
  })

  // GET /notifications/prefs
  .get("/prefs", async (c) => {
    const user = c.get("user");
    const prefs = await notificationService.getPrefs(user.userId);
    return ok(c, prefs, "ดึง notification preferences สำเร็จ");
  })

  // PUT /notifications/prefs — upsert subset
  .put("/prefs", validate("json", updatePrefsBody), async (c) => {
    const user = c.get("user");
    const { items } = c.req.valid("json");
    const updated = await notificationService.updatePrefs(user.userId, items);
    return ok(c, updated, "อัปเดต preferences สำเร็จ");
  })

  // GET /notifications/quiet-hours
  .get("/quiet-hours", async (c) => {
    const user = c.get("user");
    const qh = await notificationService.getQuietHours(user.userId);
    return ok(c, qh, "ดึง quiet hours สำเร็จ");
  })

  // PUT /notifications/quiet-hours
  .put("/quiet-hours", validate("json", quietHoursBody), async (c) => {
    const user = c.get("user");
    const { start, end } = c.req.valid("json");
    const updated = await notificationService.setQuietHours(user.userId, start, end);
    return ok(c, updated, "อัปเดต quiet hours สำเร็จ");
  });
