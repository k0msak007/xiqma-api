import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  date,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { employees } from "./employees.schema.ts";

// ── Tables ────────────────────────────────────────────────────────────────────

export const weeklyReports = pgTable("weekly_reports", {
  id:               uuid("id").primaryKey().defaultRandom(),
  employeeId:       uuid("employee_id").notNull().references(() => employees.id),
  weekStart:        date("week_start").notNull(),       // วันจันทร์ของสัปดาห์
  tasksDone:        integer("tasks_done").notNull().default(0),
  tasksOverdue:     integer("tasks_overdue").notNull().default(0),
  totalManday:      numeric("total_manday").notNull().default("0"),
  actualHours:      numeric("actual_hours").notNull().default("0"),
  expectedPoints:   numeric("expected_points"),
  actualPoints:     numeric("actual_points"),
  performanceRatio: numeric("performance_ratio"),
  performanceLabel: text("performance_label"),          // Excellent | Good | Fair | Poor
  avgScore:         numeric("avg_score"),
  rank:             integer("rank"),
  prevWeekScore:    numeric("prev_week_score"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueEmployeeWeek: unique("weekly_reports_employee_week_unique").on(t.employeeId, t.weekStart),
}));

export const monthlyHrReports = pgTable("monthly_hr_reports", {
  id:               uuid("id").primaryKey().defaultRandom(),
  employeeId:       uuid("employee_id").notNull().references(() => employees.id),
  year:             integer("year").notNull(),
  month:            integer("month").notNull(),          // 1-12
  leaveDaysTaken:   integer("leave_days_taken").notNull().default(0),
  absentDays:       integer("absent_days").notNull().default(0),
  lateDays:         integer("late_days").notNull().default(0),
  totalHoursWorked: numeric("total_hours_worked").notNull().default("0"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailySummaries = pgTable("daily_summaries", {
  id:           uuid("id").primaryKey().defaultRandom(),
  summaryDate:  date("summary_date").notNull().unique(),
  doneCount:    integer("done_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  overdueCount: integer("overdue_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  teamAvgScore: numeric("team_avg_score"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const weeklyReportsRelations = relations(weeklyReports, ({ one }) => ({
  employee: one(employees, { fields: [weeklyReports.employeeId], references: [employees.id] }),
}));

export const monthlyHrReportsRelations = relations(monthlyHrReports, ({ one }) => ({
  employee: one(employees, { fields: [monthlyHrReports.employeeId], references: [employees.id] }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type WeeklyReport       = typeof weeklyReports.$inferSelect;
export type NewWeeklyReport    = typeof weeklyReports.$inferInsert;
export type MonthlyHrReport    = typeof monthlyHrReports.$inferSelect;
export type NewMonthlyHrReport = typeof monthlyHrReports.$inferInsert;
export type DailySummary       = typeof dailySummaries.$inferSelect;
export type NewDailySummary    = typeof dailySummaries.$inferInsert;
