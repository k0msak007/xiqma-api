import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { checkInSchema, checkOutSchema } from "@/validators/leave.validator.ts";
import { attendanceService } from "@/services/leave.service.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

const attendance = new Hono().use(authMiddleware);

// POST /attendance/check-in - Check in
attendance.post("/check-in", async (c) => {
  const user = c.get("user");

  const result = await attendanceService.checkIn(user.userId);
  return c.json({ success: true, data: result, message: "เช็คอินสำเร็จ" }, 201);
});

// POST /attendance/check-out - Check out
attendance.post("/check-out", async (c) => {
  const user = c.get("user");

  const result = await attendanceService.checkOut(user.userId);
  return c.json({ success: true, data: result, message: "เช็คเอาต์สำเร็จ" });
});

// GET /attendance/today - Get today's status
attendance.get("/today", async (c) => {
  const user = c.get("user");

  const result = await attendanceService.getTodayStatus(user.userId);
  return c.json({ success: true, data: result, message: "ดึงสถานะวันนี้สำเร็จ" });
});

// GET /attendance?employee_id=&month=&year= - Get attendance history
attendance.get("/", async (c) => {
  const user = c.get("user");
  const { employee_id, month, year } = c.req.query();

  const monthNum = month ? parseInt(month) : undefined;
  const yearNum = year ? parseInt(year) : undefined;

  const result = await attendanceService.list({
    employeeId: employee_id || undefined,
    month: monthNum,
    year: yearNum,
    userId: user.userId,
    userRole: user.role,
  });

  return c.json({ success: true, data: result, message: "ดึงประวัติการเข้างานสำเร็จ" });
});

// GET /attendance/team?date= - Get team attendance
attendance.get("/team", async (c) => {
  const user = c.get("user");
  
  if (!["manager", "admin", "hr"].includes(user.role)) {
    throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ดูการเข้างานของทีม", 403);
  }

  const { date } = c.req.query();
  const targetDate: string = date !== undefined ? date : (new Date().toISOString().split("T")[0] as string);

  const result = await attendanceService.getTeamAttendance(targetDate, user.userId as string);
  return c.json({ success: true, data: result, message: "ดึงการเข้างานของทีมสำเร็จ" });
});

export const attendanceRouter = attendance;