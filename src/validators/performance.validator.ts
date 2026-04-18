import { z } from "zod";

// ── Performance Config ─────────────────────────────────────────────────────────

export const createPerformanceConfigSchema = z.object({
  employee_id:           z.string().uuid("employee_id ต้องเป็น UUID"),
  work_schedule_id:      z.string().uuid("work_schedule_id ต้องเป็น UUID"),
  expected_ratio:        z.number().min(0).max(1).default(0.8),
  pointed_work_percent:  z.number().int().min(0).max(100).default(80),
  point_target:          z.number().int().min(0).optional(),
  point_period:          z.enum(["day", "week", "month", "year"]).default("week"),
  effective_from:        z.string().date().optional(),
});

export type CreatePerformanceConfigInput = z.infer<typeof createPerformanceConfigSchema>;

// ── Analytics Queries ──────────────────────────────────────────────────────────

export const analyticsPerformanceQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  period:      z.enum(["week", "month", "quarter", "year"]).optional().default("month"),
  start:       z.string().date("start ต้องเป็น YYYY-MM-DD").optional(),
  end:         z.string().date("end ต้องเป็น YYYY-MM-DD").optional(),
});

export type AnalyticsPerformanceQuery = z.infer<typeof analyticsPerformanceQuerySchema>;

export const velocityQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  weeks:       z.coerce.number().int().min(1).max(52).default(8),
});

export type VelocityQuery = z.infer<typeof velocityQuerySchema>;

export const efficiencyQuerySchema = z.object({
  period:      z.enum(["week", "month", "quarter", "year"]).default("month"),
  employee_id: z.string().uuid().optional(),
});

export type EfficiencyQuery = z.infer<typeof efficiencyQuerySchema>;

// ── Reports Queries ────────────────────────────────────────────────────────────

export const weeklyReportQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  week:        z.string().date("week ต้องเป็น YYYY-MM-DD (วันจันทร์)").optional(),
});

export type WeeklyReportQuery = z.infer<typeof weeklyReportQuerySchema>;

export const generateWeeklyReportSchema = z.object({
  week_start:  z.string().date("week_start ต้องเป็น YYYY-MM-DD").optional(),
  employee_id: z.string().uuid().optional(),
});

export type GenerateWeeklyReportInput = z.infer<typeof generateWeeklyReportSchema>;

export const monthlyHrReportQuerySchema = z.object({
  employee_id: z.string().uuid().optional(),
  year:        z.coerce.number().int().min(2000).max(2100).optional(),
  month:       z.coerce.number().int().min(1).max(12).optional(),
});

export type MonthlyHrReportQuery = z.infer<typeof monthlyHrReportQuerySchema>;
