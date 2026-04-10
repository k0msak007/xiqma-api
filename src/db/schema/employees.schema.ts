import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", [
  "employee", "manager", "hr", "admin",
]);

export const pointPeriodEnum = pgEnum("point_period", [
  "day", "week", "month", "year",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const positions = pgTable("positions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  name:             text("name").notNull(),
  department:       text("department"),
  level:            integer("level").notNull().default(6),
  jobLevelCode:     text("job_level_code"),
  color:            text("color").notNull().default("#6b7280"),
  parentPositionId: uuid("parent_position_id"),
  isActive:         boolean("is_active").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull().unique(),
  description: text("description"),
  color:       text("color").notNull().default("#6b7280"),
  permissions: jsonb("permissions").notNull().default([]),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employees = pgTable("employees", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  employeeCode:       text("employee_code").notNull().unique(),
  name:               text("name").notNull(),
  email:              text("email").unique(),
  passwordHash:       text("password_hash"),
  avatarUrl:          text("avatar_url"),
  role:               userRoleEnum("role").notNull().default("employee"),
  roleId:             uuid("role_id").references(() => roles.id),
  positionId:         uuid("position_id").references(() => positions.id),
  managerId:          uuid("manager_id"),
  department:         text("department"),
  lineUserId:         text("line_user_id").unique(),
  lineAccessToken:    text("line_access_token"),
  clickupUserId:      text("clickup_user_id"),
  leaveQuotaAnnual:   integer("leave_quota_annual").notNull().default(10),
  leaveQuotaSick:     integer("leave_quota_sick").notNull().default(30),
  leaveQuotaPersonal: integer("leave_quota_personal").notNull().default(3),
  isActive:           boolean("is_active").notNull().default(false),
  registeredAt:       timestamp("registered_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workSchedules = pgTable("work_schedules", {
  id:            uuid("id").primaryKey().defaultRandom(),
  name:          text("name").notNull(),
  daysPerWeek:   numeric("days_per_week").notNull().default("5"),
  hoursPerDay:   numeric("hours_per_day").notNull().default("8"),
  // GENERATED ALWAYS AS (days_per_week * hours_per_day) STORED ใน DB — อย่า insert ค่านี้
  hoursPerWeek:  numeric("hours_per_week"),
  workDays:      integer("work_days").array().notNull().default([1, 2, 3, 4, 5]),
  workStartTime: text("work_start_time").notNull().default("09:00"),
  workEndTime:   text("work_end_time").notNull().default("18:00"),
  isDefault:     boolean("is_default").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employeePerformanceConfig = pgTable("employee_performance_config", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  employeeId:            uuid("employee_id").notNull().unique().references(() => employees.id),
  workScheduleId:        uuid("work_schedule_id").notNull().references(() => workSchedules.id),
  expectedRatio:         numeric("expected_ratio").notNull().default("0.80"),
  pointedWorkPercent:    integer("pointed_work_percent").notNull().default(80),
  // GENERATED ALWAYS AS (100 - pointed_work_percent) STORED ใน DB — อย่า insert ค่านี้
  nonPointedWorkPercent: integer("non_pointed_work_percent"),
  pointTarget:           integer("point_target"),
  pointPeriod:           pointPeriodEnum("point_period").notNull().default("week"),
  effectiveFrom:         date("effective_from").notNull().defaultNow(),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id:         uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  tokenHash:  text("token_hash").notNull().unique(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const positionsRelations = relations(positions, ({ one, many }) => ({
  parent:    one(positions, { fields: [positions.parentPositionId], references: [positions.id] }),
  children:  many(positions),
  employees: many(employees),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  employees: many(employees),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  role:              one(roles,     { fields: [employees.roleId],     references: [roles.id] }),
  position:          one(positions, { fields: [employees.positionId], references: [positions.id] }),
  manager:           one(employees, { fields: [employees.managerId],  references: [employees.id] }),
  reports:           many(employees),
  performanceConfig: one(employeePerformanceConfig, {
    fields: [employees.id], references: [employeePerformanceConfig.employeeId],
  }),
  refreshTokens: many(refreshTokens),
}));

export const workSchedulesRelations = relations(workSchedules, ({ many }) => ({
  performanceConfigs: many(employeePerformanceConfig),
}));

export const employeePerformanceConfigRelations = relations(
  employeePerformanceConfig,
  ({ one }) => ({
    employee:     one(employees,     { fields: [employeePerformanceConfig.employeeId],     references: [employees.id] }),
    workSchedule: one(workSchedules, { fields: [employeePerformanceConfig.workScheduleId], references: [workSchedules.id] }),
  })
);

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  employee: one(employees, { fields: [refreshTokens.employeeId], references: [employees.id] }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type Position                     = typeof positions.$inferSelect;
export type NewPosition                  = typeof positions.$inferInsert;
export type Role                         = typeof roles.$inferSelect;
export type NewRole                      = typeof roles.$inferInsert;
export type Employee                     = typeof employees.$inferSelect;
export type NewEmployee                  = typeof employees.$inferInsert;
export type WorkSchedule                 = typeof workSchedules.$inferSelect;
export type NewWorkSchedule              = typeof workSchedules.$inferInsert;
export type EmployeePerformanceConfig    = typeof employeePerformanceConfig.$inferSelect;
export type NewEmployeePerformanceConfig = typeof employeePerformanceConfig.$inferInsert;
export type RefreshToken                 = typeof refreshTokens.$inferSelect;
export type NewRefreshToken              = typeof refreshTokens.$inferInsert;
