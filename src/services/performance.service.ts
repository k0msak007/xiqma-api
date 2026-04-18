import { AppError, ErrorCode } from "@/lib/errors.ts";
import {
  performanceConfigRepository,
  analyticsRepository,
  reportsRepository,
} from "@/repositories/performance.repository.ts";
import type {
  CreatePerformanceConfigInput,
  AnalyticsPerformanceQuery,
  VelocityQuery,
  EfficiencyQuery,
  WeeklyReportQuery,
  GenerateWeeklyReportInput,
  MonthlyHrReportQuery,
} from "@/validators/performance.validator.ts";

// ── Performance Config ─────────────────────────────────────────────────────────

export const performanceConfigService = {
  async getMe(userId: string) {
    const config = await performanceConfigRepository.findByEmployee(userId);
    if (!config) {
      throw new AppError(ErrorCode.NOT_FOUND, "ยังไม่มีการตั้งค่า performance config สำหรับคุณ", 404);
    }
    return config;
  },

  async getByEmployee(employeeId: string, userId: string, userRole: string) {
    if (userRole === "employee" && employeeId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "ไม่มีสิทธิ์ดู performance config ของคนอื่น", 403);
    }
    const config = await performanceConfigRepository.findByEmployee(employeeId);
    if (!config) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `ไม่พบ performance config ของพนักงาน id: ${employeeId}`,
        404,
      );
    }
    return config;
  },

  async upsert(data: CreatePerformanceConfigInput, userRole: string) {
    if (!["admin", "manager"].includes(userRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, "เฉพาะ admin และ manager เท่านั้นที่ตั้งค่าได้", 403);
    }
    return performanceConfigRepository.upsert(data);
  },
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analyticsService = {
  async getPerformanceSummary(
    params: AnalyticsPerformanceQuery,
    userId: string,
    userRole: string,
  ) {
    if (params.start && params.end && params.start > params.end) {
      throw new AppError(ErrorCode.INVALID_DATE_RANGE, "start ต้องน้อยกว่าหรือเท่ากับ end", 400);
    }
    return analyticsRepository.getPerformanceSummary({ ...params, userId, userRole });
  },

  async getVelocity(params: VelocityQuery, userId: string, userRole: string) {
    if (userRole === "employee") {
      // employee เห็นแค่ของตัวเอง ไม่ว่า query จะส่ง employee_id มาหรือไม่
      return analyticsRepository.getVelocity({ ...params, employee_id: undefined, userId, userRole });
    }
    return analyticsRepository.getVelocity({ ...params, userId, userRole });
  },

  async getEfficiency(params: EfficiencyQuery, userId: string, userRole: string) {
    if (userRole === "employee") {
      throw new AppError(ErrorCode.FORBIDDEN, "ฟีเจอร์นี้สำหรับ manager และ admin", 403);
    }
    return analyticsRepository.getEfficiency({ ...params, userId, userRole });
  },

  async getBottleneck(userRole: string) {
    if (userRole === "employee") {
      throw new AppError(ErrorCode.FORBIDDEN, "ฟีเจอร์นี้สำหรับ manager และ admin", 403);
    }
    return analyticsRepository.getBottleneck();
  },

  async getTeamWorkload(userId: string, userRole: string) {
    if (userRole === "employee") {
      throw new AppError(ErrorCode.FORBIDDEN, "ฟีเจอร์นี้สำหรับ manager และ admin", 403);
    }
    return analyticsRepository.getTeamWorkload({ userId, userRole });
  },
};

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsService = {
  async getWeeklyReport(params: WeeklyReportQuery, userId: string, userRole: string) {
    return reportsRepository.getWeeklyReport({ ...params, userId, userRole });
  },

  async getWeeklyTeamReport(params: { week?: string | undefined }, userId: string, userRole: string) {
    if (userRole === "employee") {
      throw new AppError(ErrorCode.FORBIDDEN, "ฟีเจอร์นี้สำหรับ manager และ admin", 403);
    }
    return reportsRepository.getWeeklyTeamReport({ ...params, userId, userRole });
  },

  async generateWeeklyReport(data: GenerateWeeklyReportInput, userRole: string) {
    if (userRole !== "admin") {
      throw new AppError(ErrorCode.FORBIDDEN, "เฉพาะ admin เท่านั้นที่ generate รายงานได้", 403);
    }
    return reportsRepository.generateWeeklyReport(data);
  },

  async getMonthlyHrReport(params: MonthlyHrReportQuery, userId: string, userRole: string) {
    if (userRole === "employee") {
      // employee เห็นแค่ของตัวเอง
      return reportsRepository.getMonthlyHrReport({
        ...params,
        employee_id: userId,
        userId,
        userRole,
      });
    }
    if (!["hr", "admin"].includes(userRole)) {
      throw new AppError(ErrorCode.FORBIDDEN, "ฟีเจอร์นี้สำหรับ HR และ admin", 403);
    }
    return reportsRepository.getMonthlyHrReport({ ...params, userId, userRole });
  },
};
