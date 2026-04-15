import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { folderService } from "@/services/folder.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createFolderSchema,
  updateFolderSchema,
  listFoldersSchema,
} from "@/validators/folder.validator.ts";
import { z } from "zod";

const idParamSchema = z.object({ id: z.string().uuid() });

export const foldersRouter = new Hono()
  .use(authMiddleware)

  // GET /folders?space_id=&include_archived=
  .get("/", validate("query", listFoldersSchema), async (c) => {
    const query = c.req.valid("query");
    const user = c.get("user");
    const folders = await folderService.list(query, user.userId, user.role === "admin");
    return ok(c, folders, "ดึงข้อมูล folder สำเร็จ");
  })

  // POST /folders
  .post("/", validate("json", createFolderSchema), async (c) => {
    const data = c.req.valid("json");
    const user = c.get("user");
    const folder = await folderService.create(data, user.userId, user.role === "admin");
    return created(c, folder, "สร้าง folder สำเร็จ");
  })

  // PUT /folders/:id
  .put("/:id", validate("param", idParamSchema), validate("json", updateFolderSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const folder = await folderService.update(id, data);
    return ok(c, folder, "แก้ไข folder สำเร็จ");
  })

  // PATCH /folders/:id/archive
  .patch("/:id/archive", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const folder = await folderService.archive(id);
    return ok(c, folder, "archive folder สำเร็จ");
  })

  // PATCH /folders/:id/restore
  .patch("/:id/restore", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const folder = await folderService.restore(id);
    return ok(c, folder, "restore folder สำเร็จ");
  })

  // DELETE /folders/:id
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await folderService.delete(id);
    return ok(c, null, "ลบ folder สำเร็จ");
  });
