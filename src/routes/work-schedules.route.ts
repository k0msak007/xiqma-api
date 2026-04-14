import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { workScheduleService } from "@/services/work-schedule.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createWorkScheduleSchema,
  updateWorkScheduleSchema,
  idParamSchema,
} from "@/validators/work-schedule.validator.ts";

export const workSchedulesRouter = new Hono()
  .use(authMiddleware)

  // GET /work-schedules — list all schedules
  .get("/", async (c) => {
    const schedules = await workScheduleService.list();
    return ok(c, schedules, "ดึงข้อมูล work schedules สำเร็จ");
  })

  // GET /work-schedules/:id — get schedule by id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const schedule = await workScheduleService.findById(id);
    return ok(c, schedule, "ดึงข้อมูล work schedule สำเร็จ");
  })

  // POST /work-schedules — create schedule
  .post("/", validate("json", createWorkScheduleSchema), async (c) => {
    const data = c.req.valid("json");
    const schedule = await workScheduleService.create(data);
    return created(c, schedule, "สร้าง work schedule สำเร็จ");
  })

  // PUT /work-schedules/:id — update schedule
  .put(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateWorkScheduleSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const schedule = await workScheduleService.update(id, data);
      return ok(c, schedule, "แก้ไข work schedule สำเร็จ");
    }
  )

  // DELETE /work-schedules/:id — delete schedule
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await workScheduleService.delete(id);
    return ok(c, null, "ลบ work schedule สำเร็จ");
  });
