import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware, requirePermission } from "@/middleware/auth.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import { employeeService } from "@/services/employee.service.ts";
import { ok, created, paginate } from "@/lib/response.ts";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  listEmployeesSchema,
  changePasswordSchema,
} from "@/validators/employee.validator.ts";
import { z } from "zod";

const idParamSchema = z.object({
  id: z.string().uuid("id ต้องเป็น UUID"),
});

// ทุก route ใน group นี้ต้องผ่าน authMiddleware
export const employeesRouter = new Hono()
  .use(authMiddleware)

  // GET /employees — list with pagination + search (hr/admin/manage_users เท่านั้น)
  .get("/", requirePermission("manage_users"), validate("query", listEmployeesSchema), async (c) => {
    const query = c.req.valid("query");
    const { rows, total } = await employeeService.list(query);
    const { page, limit, buildMeta } = paginate(c);
    return ok(c, rows, "ดึงข้อมูลพนักงานสำเร็จ", buildMeta(total));
  })

  // GET /employees/all — list all active employees (any authenticated user)
  .get("/all", async (c) => {
    const { rows } = await employeeService.list({ isActive: true, limit: 500 });
    return ok(c, { rows }, "ดึงข้อมูลพนักงานสำเร็จ");
  })

  // GET /employees/:id — get employee by id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const employee = await employeeService.findById(id);
    return ok(c, employee, "ดึงข้อมูลพนักงานสำเร็จ");
  })

  // POST /employees — create employee (requires manage_users)
  .post(
    "/",
    requirePermission("manage_users"),
    validate("json", createEmployeeSchema),
    async (c) => {
      const data = c.req.valid("json");
      const employee = await employeeService.create(data);
      return created(c, employee, "สร้างพนักงานสำเร็จ");
    }
  )

  // PUT /employees/:id — update employee (requires manage_users)
  .put(
    "/:id",
    requirePermission("manage_users"),
    validate("param", idParamSchema),
    validate("json", updateEmployeeSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const employee = await employeeService.update(id, data);
      return ok(c, employee, "แก้ไขข้อมูลพนักงานสำเร็จ");
    }
  )

  // PATCH /employees/:id/deactivate — soft delete (deactivate)
  .patch(
    "/:id/deactivate",
    requirePermission("manage_users"),
    validate("param", idParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const employee = await employeeService.deactivate(id);
      return ok(c, employee, "ปิดการใช้งานพนักงานสำเร็จ");
    }
  )

  // PATCH /employees/:id/avatar — upload avatar (owner or manage_users)
  .patch(
    "/:id/avatar",
    validate("param", idParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const user = c.get("user");

      if (id !== user.userId && !user.permissions.includes("manage_users")) {
        throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์แก้ไขรูปโปรไฟล์ของผู้อื่น", 403);
      }

      const formData = await c.req.formData();
      const fileResult = formData.get("file");
      const file = fileResult instanceof File ? fileResult : null;

      if (!file || !file.name) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "กรุณาแนบไฟล์รูปภาพ", 400);
      }

      const employee = await employeeService.updateAvatar(id, file);
      return ok(c, employee, "อัปโหลดรูปโปรไฟล์สำเร็จ");
    }
  )

  // PUT /employees/me/password — change own password
  .put(
    "/me/password",
    validate("json", changePasswordSchema),
    async (c) => {
      const user = c.get("user");
      const data = c.req.valid("json");
      await employeeService.changePassword(user.userId, data);
      return ok(c, null, "เปลี่ยนรหัสผ่านสำเร็จ");
    }
  );
