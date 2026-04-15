import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { listService } from "@/services/list.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createListSchema,
  updateListSchema,
  listQuerySchema,
  createStatusSchema,
  updateStatusSchema,
  reorderStatusSchema,
} from "@/validators/list.validator.ts";
import { z } from "zod";

const idParamSchema      = z.object({ id: z.string().uuid() });
const statusParamSchema  = z.object({ id: z.string().uuid(), statusId: z.string().uuid() });

export const listsRouter = new Hono()
  .use(authMiddleware)

  // GET /lists?space_id=&folder_id=
  .get("/", validate("query", listQuerySchema), async (c) => {
    const { spaceId, folderId } = c.req.valid("query");
    const user = c.get("user");
    const lists = await listService.list(spaceId, folderId, user.userId, user.role === "admin");
    return ok(c, lists, "ดึงข้อมูล list สำเร็จ");
  })

  // POST /lists
  .post("/", validate("json", createListSchema), async (c) => {
    const data = c.req.valid("json");
    const user = c.get("user");
    const list = await listService.create(data, user.userId, user.role === "admin");
    return created(c, list, "สร้าง list สำเร็จ");
  })

  // PUT /lists/:id
  .put("/:id", validate("param", idParamSchema), validate("json", updateListSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const list = await listService.update(id, data);
    return ok(c, list, "แก้ไข list สำเร็จ");
  })

  // DELETE /lists/:id
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await listService.delete(id);
    return ok(c, null, "ลบ list สำเร็จ");
  })

  // GET /lists/:id/statuses
  .get("/:id/statuses", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const statuses = await listService.listStatuses(id);
    return ok(c, statuses, "ดึงข้อมูล status สำเร็จ");
  })

  // POST /lists/:id/statuses
  .post("/:id/statuses", validate("param", idParamSchema), validate("json", createStatusSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const status = await listService.createStatus(id, data);
    return created(c, status, "สร้าง status สำเร็จ");
  })

  // PUT /lists/:id/statuses/reorder  (must come BEFORE /:id/statuses/:statusId to avoid route conflict)
  .put("/:id/statuses/reorder", validate("param", idParamSchema), validate("json", reorderStatusSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const statuses = await listService.reorderStatuses(id, data);
    return ok(c, statuses, "เรียงลำดับ status สำเร็จ");
  })

  // PUT /lists/:id/statuses/:statusId
  .put("/:id/statuses/:statusId", validate("param", statusParamSchema), validate("json", updateStatusSchema), async (c) => {
    const { id, statusId } = c.req.valid("param");
    const data = c.req.valid("json");
    const status = await listService.updateStatus(id, statusId, data);
    return ok(c, status, "แก้ไข status สำเร็จ");
  })

  // DELETE /lists/:id/statuses/:statusId
  .delete("/:id/statuses/:statusId", validate("param", statusParamSchema), async (c) => {
    const { id, statusId } = c.req.valid("param");
    await listService.deleteStatus(id, statusId);
    return ok(c, null, "ลบ status สำเร็จ");
  });
