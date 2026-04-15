import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { spaceService } from "@/services/space.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createSpaceSchema,
  updateSpaceSchema,
  addMembersSchema,
} from "@/validators/space.validator.ts";
import { z } from "zod";

const idParamSchema = z.object({ id: z.string().uuid() });
const memberParamSchema = z.object({ id: z.string().uuid(), employeeId: z.string().uuid() });

export const spacesRouter = new Hono()
  .use(authMiddleware)

  // GET /spaces
  .get("/", async (c) => {
    const user = c.get("user");
    const isAdmin = user.role === "admin";
    const spaces = await spaceService.list(user.userId, isAdmin);
    return ok(c, spaces, "ดึงข้อมูล space สำเร็จ");
  })

  // GET /spaces/:id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const user = c.get("user");
    const isAdmin = user.role === "admin";
    const space = await spaceService.findById(id, user.userId, isAdmin);
    return ok(c, space, "ดึงข้อมูล space สำเร็จ");
  })

  // POST /spaces
  .post("/", validate("json", createSpaceSchema), async (c) => {
    const data = c.req.valid("json");
    const user = c.get("user");
    const space = await spaceService.create(data, user.userId);
    return created(c, space, "สร้าง space สำเร็จ");
  })

  // PUT /spaces/:id
  .put("/:id", validate("param", idParamSchema), validate("json", updateSpaceSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    const user = c.get("user");
    const isAdmin = user.role === "admin";
    const space = await spaceService.update(id, data, user.userId, isAdmin);
    return ok(c, space, "แก้ไข space สำเร็จ");
  })

  // DELETE /spaces/:id  (admin only)
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await spaceService.delete(id);
    return ok(c, null, "ลบ space สำเร็จ");
  })

  // POST /spaces/:id/members
  .post("/:id/members", validate("param", idParamSchema), validate("json", addMembersSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data = c.req.valid("json");
    await spaceService.addMembers(id, data);
    return ok(c, null, "เพิ่มสมาชิกสำเร็จ");
  })

  // DELETE /spaces/:id/members/:employeeId
  .delete("/:id/members/:employeeId", validate("param", memberParamSchema), async (c) => {
    const { id, employeeId } = c.req.valid("param");
    await spaceService.removeMember(id, employeeId);
    return ok(c, null, "ลบสมาชิกออกสำเร็จ");
  });
