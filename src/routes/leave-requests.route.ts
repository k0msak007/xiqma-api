import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { idParamSchema } from "@/validators/common.ts";
import {
  createLeaveRequestSchema,
  approveLeaveRequestSchema,
  rejectLeaveRequestSchema,
  cancelLeaveRequestSchema,
} from "@/validators/leave.validator.ts";
import { leaveService } from "@/services/leave.service.ts";

const leaveRequests = new Hono().use(authMiddleware);

// GET /leave-requests - List all leave requests
leaveRequests.get("/", async (c) => {
  const user = c.get("user");
  const { employee_id, status, year, month, page, limit } = c.req.query();

  const result = await leaveService.list({
    employeeId: employee_id,
    status,
    year: year ? parseInt(year) : undefined,
    month: month ? parseInt(month) : undefined,
    page: page ? parseInt(page) : 1,
    limit: limit ? parseInt(limit) : 20,
    userId: user.userId,
    userRole: user.role,
  });

  return c.json({ success: true, data: result.rows, meta: { total: result.total, page: result.page, limit: result.limit } });
});

// GET /leave-requests/:id - Get leave request by ID
leaveRequests.get("/:id", validate("param", idParamSchema), async (c) => {
  const user = c.get("user");
  const { id } = c.req.valid("param");

  const leave = await leaveService.getById(id, user.userId, user.role);
  return c.json({ success: true, data: leave, message: "ดึงข้อมูลการลาสำเร็จ" });
});

// POST /leave-requests - Create new leave request
leaveRequests.post("/", validate("json", createLeaveRequestSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");

  const leave = await leaveService.create(data, user.userId, user.role);
  return c.json({ success: true, data: leave, message: "สร้างการลาสำเร็จ" }, 201);
});

// PATCH /leave-requests/:id/approve - Approve leave request
leaveRequests.patch("/:id/approve", validate("param", idParamSchema), validate("json", approveLeaveRequestSchema), async (c) => {
  const user = c.get("user");
  const { id } = c.req.valid("param");

  const leave = await leaveService.approve(id, user.userId, user.role);
  return c.json({ success: true, data: leave, message: "อนุมัติการลาสำเร็จ" });
});

// PATCH /leave-requests/:id/reject - Reject leave request
leaveRequests.patch("/:id/reject", validate("param", idParamSchema), validate("json", rejectLeaveRequestSchema), async (c) => {
  const user = c.get("user");
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");

  const leave = await leaveService.reject(id, data, user.userId, user.role);
  return c.json({ success: true, data: leave, message: "ปฏิเสธการลาสำเร็จ" });
});

// PATCH /leave-requests/:id/cancel - Cancel leave request
leaveRequests.patch("/:id/cancel", validate("param", idParamSchema), validate("json", cancelLeaveRequestSchema), async (c) => {
  const user = c.get("user");
  const { id } = c.req.valid("param");

  const leave = await leaveService.cancel(id, user.userId, user.role);
  return c.json({ success: true, data: leave, message: "ยกเลิกการลาสำเร็จ" });
});

export const leaveRequestsRouter = leaveRequests;