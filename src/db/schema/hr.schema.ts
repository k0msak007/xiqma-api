import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { employees } from "./employees.schema.ts";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const leaveTypeEnum = pgEnum("leave_type", [
  "annual", "sick", "personal", "maternity", "ordain", "unpaid",
]);

export const leaveStatusEnum = pgEnum("leave_status", [
  "pending", "approved", "rejected", "cancelled",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present", "late", "absent", "leave", "holiday",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const companyHolidays = pgTable("company_holidays", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  holidayDate: date("holiday_date").notNull().unique(),
  isRecurring: boolean("is_recurring").notNull().default(false),
  note:        text("note"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveRequests = pgTable("leave_requests", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  displayId:             text("display_id").unique(),
  employeeId:            uuid("employee_id").notNull().references(() => employees.id),
  approvedBy:            uuid("approved_by").references(() => employees.id),
  leaveType:             leaveTypeEnum("leave_type").notNull(),
  startDate:             date("start_date").notNull(),
  endDate:               date("end_date").notNull(),
  // plain integer — handler คำนวณจาก working days (ข้าม weekend + วันหยุด)
  totalDays:             integer("total_days"),
  reason:                text("reason"),
  medicalCertificateUrl: text("medical_certificate_url"),
  status:                leaveStatusEnum("status").notNull().default("pending"),
  reviewedAt:            timestamp("reviewed_at", { withTimezone: true }),
  rejectReason:          text("reject_reason"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveQuotas = pgTable("leave_quotas", {
  id:         uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  year:       integer("year").notNull(),
  leaveType:  leaveTypeEnum("leave_type").notNull(),
  quotaDays:  integer("quota_days").notNull().default(0),
  usedDays:   integer("used_days").notNull().default(0),
  // remainingDays = GENERATED ALWAYS AS (quota_days - used_days) STORED ใน DB — อย่า insert ค่านี้
  remainingDays: integer("remaining_days"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceLogs = pgTable("attendance_logs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  employeeId:      uuid("employee_id").notNull().references(() => employees.id),
  workDate:        date("work_date").notNull(),
  checkIn:         timestamp("check_in", { withTimezone: true }),
  checkOut:        timestamp("check_out", { withTimezone: true }),
  status:          attendanceStatusEnum("status").notNull().default("present"),
  leaveRequestId:  uuid("leave_request_id").references(() => leaveRequests.id),
  note:            text("note"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const leaveRequestsRelations = relations(leaveRequests, ({ one, many }) => ({
  employee:      one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
  reviewer:      one(employees, { fields: [leaveRequests.approvedBy], references: [employees.id] }),
  attendanceLogs: many(attendanceLogs),
}));

export const leaveQuotasRelations = relations(leaveQuotas, ({ one }) => ({
  employee: one(employees, { fields: [leaveQuotas.employeeId], references: [employees.id] }),
}));

export const attendanceLogsRelations = relations(attendanceLogs, ({ one }) => ({
  employee:     one(employees,     { fields: [attendanceLogs.employeeId],     references: [employees.id] }),
  leaveRequest: one(leaveRequests, { fields: [attendanceLogs.leaveRequestId], references: [leaveRequests.id] }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompanyHoliday    = typeof companyHolidays.$inferSelect;
export type NewCompanyHoliday = typeof companyHolidays.$inferInsert;
export type LeaveRequest      = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest   = typeof leaveRequests.$inferInsert;
export type LeaveQuota        = typeof leaveQuotas.$inferSelect;
export type NewLeaveQuota     = typeof leaveQuotas.$inferInsert;
export type AttendanceLog     = typeof attendanceLogs.$inferSelect;
export type NewAttendanceLog  = typeof attendanceLogs.$inferInsert;
