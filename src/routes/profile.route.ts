import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok } from "@/lib/response.ts";
import { profileService } from "@/services/profile.service.ts";
import { taskService } from "@/services/task.service.ts";
import { analyticsService } from "@/services/performance.service.ts";
import { updateProfileSchema } from "@/validators/profile.validator.ts";
import { myTasksQuerySchema } from "@/validators/task.validator.ts";
import { analyticsPerformanceQuerySchema } from "@/validators/performance.validator.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

export const profileRouter = new Hono()
  .use(authMiddleware)

  // GET /profile — ดูโปรไฟล์ตัวเอง
  .get("/", async (c) => {
    const user = c.get("user");
    const profile = await profileService.getMe(user.userId);
    return ok(c, profile, "ดึงข้อมูลโปรไฟล์สำเร็จ");
  })

  // PUT /profile — แก้ชื่อ/email
  .put("/", validate("json", updateProfileSchema), async (c) => {
    const user = c.get("user");
    const data = c.req.valid("json");
    const updated = await profileService.updateMe(user.userId, data);
    return ok(c, updated, "แก้ไขโปรไฟล์สำเร็จ");
  })

  // GET /profile/my-tasks
  .get("/my-tasks", validate("query", myTasksQuerySchema), async (c) => {
    const user = c.get("user");
    const { range } = c.req.valid("query");
    const tasks = await taskService.myTasks(user.userId, range);
    return ok(c, tasks, "ดึงข้อมูลงานของฉันสำเร็จ");
  })

  // GET /profile/performance
  .get("/performance", async (c) => {
    const user = c.get("user");
    const rawQuery = c.req.query();
    const parsed = analyticsPerformanceQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "query params ไม่ถูกต้อง",
        400,
        parsed.error.errors.map((e) => ({ field: e.path.join("."), message: e.message })),
      );
    }
    const result = await analyticsService.getPerformanceSummary(
      { ...parsed.data, employee_id: user.userId },
      user.userId,
      user.role,
    );
    return ok(c, result, "ดึงข้อมูล performance สำเร็จ");
  });
