import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { employees } from "./employees.schema.ts";
import { tasks } from "./tasks.schema.ts";
import { notifTypeEnum } from "./bot.schema.ts";

// ── Tables ────────────────────────────────────────────────────────────────────

export const notificationLogs = pgTable("notification_logs", {
  id:         uuid("id").primaryKey().defaultRandom(),
  taskId:     uuid("task_id").references(() => tasks.id),
  employeeId: uuid("employee_id").references(() => employees.id),
  notifType:  notifTypeEnum("notif_type").notNull(),
  message:    text("message"),
  isSent:     boolean("is_sent").notNull().default(false),
  sentAt:     timestamp("sent_at", { withTimezone: true }),
  isRead:     boolean("is_read").notNull().default(false),
  readAt:     timestamp("read_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id:         uuid("id").primaryKey().defaultRandom(),
  actorId:    uuid("actor_id").references(() => employees.id), // NULL = system action
  action:     text("action").notNull(),
  tableName:  text("table_name"),
  recordId:   uuid("record_id"),
  beforeData: jsonb("before_data"),
  afterData:  jsonb("after_data"),
  ipAddress:  text("ip_address"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const notificationLogsRelations = relations(notificationLogs, ({ one }) => ({
  employee: one(employees, { fields: [notificationLogs.employeeId], references: [employees.id] }),
  task:     one(tasks,     { fields: [notificationLogs.taskId],     references: [tasks.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(employees, { fields: [auditLogs.actorId], references: [employees.id] }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationLog    = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
export type AuditLog           = typeof auditLogs.$inferSelect;
export type NewAuditLog        = typeof auditLogs.$inferInsert;
