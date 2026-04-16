import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { holidayService } from "@/services/holiday.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createHolidaySchema,
  updateHolidaySchema,
  idParamSchema,
  listHolidaysSchema,
  workingDaysSchema,
} from "@/validators/holiday.validator.ts";

export const holidaysRouter = new Hono()
  .use(authMiddleware)

  // GET /holidays — list holidays, optional ?year=
  .get("/", validate("query", listHolidaysSchema), async (c) => {
    const { year } = c.req.valid("query");
    const holidays = await holidayService.list(year);
    return ok(c, holidays, "ดึงข้อมูลวันหยุดสำเร็จ");
  })

  // GET /holidays/working-days — count working days in range
  // ต้องอยู่ก่อน /:id เพื่อป้องกัน Hono จับ "working-days" เป็น param
  .get("/working-days", validate("query", workingDaysSchema), async (c) => {
    const { start, end } = c.req.valid("query");
    const result = await holidayService.countWorkingDays(start, end);
    return ok(c, result, "นับวันทำงานสำเร็จ");
  })

  // GET /holidays/:id — get holiday by id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const holiday = await holidayService.findById(id);
    return ok(c, holiday, "ดึงข้อมูลวันหยุดสำเร็จ");
  })

  // POST /holidays — create holiday
  .post("/", validate("json", createHolidaySchema), async (c) => {
    const data = c.req.valid("json");
    const holiday = await holidayService.create(data);
    return created(c, holiday, "สร้างวันหยุดสำเร็จ");
  })

  // PUT /holidays/:id — update holiday
  .put(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateHolidaySchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const holiday = await holidayService.update(id, data);
      return ok(c, holiday, "แก้ไขวันหยุดสำเร็จ");
    }
  )

  // DELETE /holidays/:id — delete holiday
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await holidayService.delete(id);
    return ok(c, null, "ลบวันหยุดสำเร็จ");
  });
