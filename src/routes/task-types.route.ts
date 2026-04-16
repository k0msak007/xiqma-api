import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { taskTypeService } from "@/services/task-type.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  listTaskTypesSchema,
  createTaskTypeSchema,
  updateTaskTypeSchema,
  idParamSchema,
} from "@/validators/task-type.validator.ts";

export const taskTypesRouter = new Hono()
  .use(authMiddleware)

  // GET /task-types — list task types, optional ?category=private|organization
  .get("/", validate("query", listTaskTypesSchema), async (c) => {
    const params = c.req.valid("query");
    const taskTypes = await taskTypeService.list(params);
    return ok(c, taskTypes, "ดึงข้อมูล task types สำเร็จ");
  })

  // GET /task-types/:id — get task type by id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const taskType = await taskTypeService.findById(id);
    return ok(c, taskType, "ดึงข้อมูล task type สำเร็จ");
  })

  // POST /task-types — create task type
  .post("/", validate("json", createTaskTypeSchema), async (c) => {
    const data = c.req.valid("json");
    const taskType = await taskTypeService.create(data);
    return created(c, taskType, "สร้าง task type สำเร็จ");
  })

  // PUT /task-types/:id — update task type
  .put(
    "/:id",
    validate("param", idParamSchema),
    validate("json", updateTaskTypeSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const taskType = await taskTypeService.update(id, data);
      return ok(c, taskType, "แก้ไข task type สำเร็จ");
    }
  )

  // DELETE /task-types/:id — delete task type
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await taskTypeService.delete(id);
    return ok(c, null, "ลบ task type สำเร็จ");
  });
