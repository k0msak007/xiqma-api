import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware, requirePermission } from "@/middleware/auth.ts";
import { roleService } from "@/services/role.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createRoleSchema,
  updateRoleSchema,
  idParamSchema,
} from "@/validators/role.validator.ts";

export const rolesRouter = new Hono()
  .use(authMiddleware)

  // GET /roles — list all roles
  .get("/", async (c) => {
    const roles = await roleService.list();
    return ok(c, roles, "ดึงข้อมูล roles สำเร็จ");
  })

  // GET /roles/:id — get role by id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const role = await roleService.findById(id);
    return ok(c, role, "ดึงข้อมูล role สำเร็จ");
  })

  // POST /roles — create role
  .post(
    "/",
    requirePermission("manage_roles"),
    validate("json", createRoleSchema),
    async (c) => {
      const data = c.req.valid("json");
      const role = await roleService.create(data);
      return created(c, role, "สร้าง role สำเร็จ");
    }
  )

  // PUT /roles/:id — update role
  .put(
    "/:id",
    requirePermission("manage_roles"),
    validate("param", idParamSchema),
    validate("json", updateRoleSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const role = await roleService.update(id, data);
      return ok(c, role, "แก้ไข role สำเร็จ");
    }
  )

  // DELETE /roles/:id — delete role
  .delete(
    "/:id",
    requirePermission("manage_roles"),
    validate("param", idParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      await roleService.delete(id);
      return ok(c, null, "ลบ role สำเร็จ");
    }
  );
