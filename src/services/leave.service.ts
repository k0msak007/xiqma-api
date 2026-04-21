import { AppError, ErrorCode } from "@/lib/errors.ts";
import { leaveRepository, leaveQuotaRepository, attendanceRepository, calculateWorkingDays } from "@/repositories/leave.repository.ts";
import { assertCanAccessEmployee } from "@/repositories/_scope.ts";
import type {
  CreateLeaveRequestInput,
  ApproveLeaveRequestInput,
  RejectLeaveRequestInput,
  CancelLeaveRequestInput,
  UpdateLeaveQuotaInput,
} from "@/validators/leave.validator.ts";

// ── Leave Service ─────────────────────────────────────────────────────────────

export const leaveService = {
  // GET /leave-requests
  async list(params: {
    employeeId: string | undefined;
    status: string | undefined;
    year: number | undefined;
    month: number | undefined;
    page: number | undefined;
    limit: number | undefined;
    userId: string;
    userRole: string;
  }) {
    // If employee, only see own requests
    const effectiveEmployeeId = params.userRole === "employee" ? params.userId : params.employeeId;

    // manager ที่ขอดู employee_id เจาะจง ต้องเป็น direct report
    if (params.userRole === "manager" && params.employeeId) {
      await assertCanAccessEmployee(params.employeeId, params.userRole, params.userId);
    }

    // manager ไม่ระบุ employee_id → จำกัดให้เห็นเฉพาะทีมตัวเอง
    const managerUserId =
      params.userRole === "manager" && !params.employeeId ? params.userId : undefined;

    return leaveRepository.findAll({
      employeeId: effectiveEmployeeId,
      status: params.status,
      year: params.year,
      month: params.month,
      page: params.page,
      limit: params.limit,
      managerUserId,
    });
  },

  // GET /leave-requests/:id
  async getById(id: string, userId: string, userRole: string) {
    const leave = await leaveRepository.findById(id);
    if (!leave) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบการลา id: ${id}`, 404);
    }

    // Employee can only view their own
    if (userRole === "employee" && leave.employeeId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ดูการลานี้", 403);
    }

    // Manager: ต้องเป็นของ direct report เท่านั้น
    if (userRole === "manager" && leave.employeeId) {
      await assertCanAccessEmployee(leave.employeeId, userRole, userId);
    }

    return leave;
  },

  // POST /leave-requests
  async create(data: CreateLeaveRequestInput, userId: string, userRole: string) {
    // Validate dates
    if (data.startDate > data.endDate) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "วันเริ่มต้นต้องน้อยกว่าวันสิ้นสุด", 400);
    }

    // Calculate working days
    const workingDays = calculateWorkingDays(data.startDate, data.endDate);
    if (workingDays === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "ไม่มีวันทำงานในช่วงที่เลือก", 400);
    }

    // Check quota
    const year = new Date(data.startDate).getFullYear();
    const quotas = await leaveQuotaRepository.findByEmployee(userId, year);
    const quota = quotas.find((q) => q.leaveType === data.leaveType);

    const quotaDays = quota?.quotaDays || 0;
    const usedDays = quota?.usedDays || 0;
    const remainingDays = quotaDays - usedDays;

    if (workingDays > remainingDays) {
      throw new AppError(
        ErrorCode.QUOTA_EXCEEDED,
        `โควตาคงเหลือไม่พอ (คงเหลือ ${remainingDays} วัน, ต้องการ ${workingDays} วัน)`,
        400
      );
    }

    return leaveRepository.create({
      employeeId: userId,
      leaveType: data.leaveType,
      startDate: data.startDate,
      endDate: data.endDate,
      totalDays: workingDays,
      reason: data.reason,
      medicalCertificateUrl: data.medicalCertificateUrl,
    });
  },

  // PATCH /leave-requests/:id/approve
  async approve(id: string, userId: string, userRole: string) {
    // Only manager, hr, admin can approve
    if (!["manager", "hr", "admin"].includes(userRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์อนุมัติการลา", 403);
    }

    const leave = await leaveRepository.findById(id);
    if (!leave) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบการลา id: ${id}`, 404);
    }

    if (leave.status !== "pending") {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "การลานี้ไม่ได้อยู่ในสถานะรอการอนุมัติ", 400);
    }

    // Update status
    const updated = await leaveRepository.updateStatus(id, {
      status: "approved",
      approvedBy: userId,
    });

    // Increment used days in quota
    if (updated && updated.totalDays) {
      const year = new Date(updated.startDate).getFullYear();
      await leaveQuotaRepository.incrementUsedDays(
        updated.employeeId,
        year,
        updated.leaveType,
        updated.totalDays
      );
    }

    return updated;
  },

  // PATCH /leave-requests/:id/reject
  async reject(id: string, data: RejectLeaveRequestInput, userId: string, userRole: string) {
    // Only manager, hr, admin can reject
    if (!["manager", "hr", "admin"].includes(userRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ปฏิเสธการลา", 403);
    }

    const leave = await leaveRepository.findById(id);
    if (!leave) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบการลา id: ${id}`, 404);
    }

    if (leave.status !== "pending") {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "การลานี้ไม่ได้อยู่ในสถานะรอการอนุมัติ", 400);
    }

    return leaveRepository.updateStatus(id, {
      status: "rejected",
      approvedBy: userId,
      rejectReason: data.rejectReason,
    });
  },

  // PATCH /leave-requests/:id/cancel
  async cancel(id: string, userId: string, userRole: string) {
    const leave = await leaveRepository.findById(id);
    if (!leave) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบการลา id: ${id}`, 404);
    }

    // Employee can only cancel their own pending leave
    if (userRole === "employee" && leave.employeeId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ยกเลิกการลานี้", 403);
    }

    const isAdmin = userRole === "admin";
    return leaveRepository.cancel(id, isAdmin);
  },
};

// ── Leave Quota Service ───────────────────────────────────────────────────────

export const leaveQuotaService = {
  // GET /leave-quotas/me?year=
  async getMyQuotas(userId: string, year?: number) {
    const effectiveYear = year || new Date().getFullYear();
    return leaveQuotaRepository.findByEmployee(userId, effectiveYear);
  },

  // GET /leave-quotas?employee_id=&year=
  async list(params: { employeeId?: string; year?: number; userRole: string }) {
    if (!["hr", "admin"].includes(params.userRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ดูโควตาการลาของพนักงาน", 403);
    }
    return leaveQuotaRepository.findAll(params);
  },

  // PUT /leave-quotas/:employee_id
  async update(employeeId: string, data: UpdateLeaveQuotaInput, userRole: string) {
    if (!["hr", "admin"].includes(userRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์แก้ไขโควตาการลา", 403);
    }

    return leaveQuotaRepository.upsert(employeeId, data.year, data.leaveType, data.quotaDays);
  },
};

// ── Attendance Service ─────────────────────────────────────────────────────────

export const attendanceService = {
  // POST /attendance/check-in
  async checkIn(userId: string) {
    const today: string = new Date().toISOString().split("T")[0] as string;
    
    // Check if already checked in
    const existing = await attendanceRepository.findByEmployeeAndDate(userId, today);
    if (existing?.checkIn) {
      throw new AppError(ErrorCode.ALREADY_EXISTS, "เช็คอินไปแล้ววันนี้", 409);
    }

    // Check if late (after 9:00 AM)
    const now = new Date();
    const hours = now.getHours();
    const isLate = hours >= 9;

    return attendanceRepository.checkIn(userId, today, isLate);
  },

  // POST /attendance/check-out
  async checkOut(userId: string) {
    const today: string = new Date().toISOString().split("T")[0] as string;
    
    const existing = await attendanceRepository.findByEmployeeAndDate(userId, today);
    if (!existing?.checkIn) {
      throw new AppError(ErrorCode.NOT_FOUND, "ยังไม่ได้เช็คอินวันนี้", 400);
    }
    if (existing?.checkOut) {
      throw new AppError(ErrorCode.ALREADY_EXISTS, "เช็คเอาต์ไปแล้ววันนี้", 409);
    }

    return attendanceRepository.checkOut(userId, today);
  },

  // GET /attendance/today
  async getTodayStatus(userId: string) {
    return attendanceRepository.getTodayStatus(userId);
  },

  // GET /attendance?employee_id=&month=&year=
  async list(params: { employeeId?: string; month?: number; year?: number; userId: string; userRole: string }) {
    // If employee, only see own attendance
    const effectiveEmployeeId = params.userRole === "employee" ? params.userId : params.employeeId;
    
    return attendanceRepository.findAll({
      employeeId: effectiveEmployeeId ?? undefined,
      month: params.month ?? undefined,
      year: params.year ?? undefined,
    });
  },

  // GET /attendance/team?date=
  async getTeamAttendance(date: string, managerId: string) {
    return attendanceRepository.findByManager(managerId, date);
  },
};