import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { idParamSchema } from "@/validators/common.ts";
import { updateLeaveQuotaSchema } from "@/validators/leave.validator.ts";
import { leaveQuotaService } from "@/services/leave.service.ts";

const leaveQuotas = new Hono().use(authMiddleware);

// GET /leave-quotas/me?year= - Get my leave quotas
leaveQuotas.get("/me", async (c) => {
  const user = c.get("user");
  const { year } = c.req.query();

  const quotas = await leaveQuotaService.getMyQuotas(user.userId, year ? parseInt(year) : undefined);
  return c.json({ success: true, data: quotas, message: "ดึงโควตาการลาสำเร็จ" });
});

// GET /leave-quotas?employee_id=&year= - Get all leave quotas (HR/Admin only)
leaveQuotas.get("/", async (c) => {
  const user = c.get("user");
  const { employee_id, year } = c.req.query();

  const quotas = await leaveQuotaService.list({
    employeeId: employee_id,
    year: year ? parseInt(year) : undefined,
    userRole: user.role,
  });

  return c.json({ success: true, data: quotas, message: "ดึงโควตาการลาสำเร็จ" });
});

// PUT /leave-quotas/:employee_id - Update leave quota
leaveQuotas.put("/:employeeId", validate("param", idParamSchema), validate("json", updateLeaveQuotaSchema), async (c) => {
  const user = c.get("user");
  const { employeeId } = c.req.valid("param");
  const data = c.req.valid("json");

  const quota = await leaveQuotaService.update(employeeId, data, user.role);
  return c.json({ success: true, data: quota, message: "อัปเดตโควตาการลาสำเร็จ" });
});

export const leaveQuotasRouter = leaveQuotas;