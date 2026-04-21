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
  });
