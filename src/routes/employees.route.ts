import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware, requirePermission } from "@/middleware/auth.ts";
import { employeeService } from "@/services/employee.service.ts";
import { ok, created, paginate } from "@/lib/response.ts";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  listEmployeesSchema,
} from "@/validators/employee.validator.ts";

// ทุก route ใน group นี้ต้องผ่าน authMiddleware
export const employeesRouter = new Hono().use(authMiddleware);
