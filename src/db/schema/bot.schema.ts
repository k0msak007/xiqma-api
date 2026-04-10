import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  serial,
  varchar,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { employees } from "./employees.schema.ts";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const notifTypeEnum = pgEnum("notif_type", [
  "assigned",
  "due_reminder",
  "overdue",
  "extension_request",
  "extension_approved",
  "extension_rejected",
  "leave_request",
  "leave_approved",
  "leave_rejected",
  "daily_summary",
  "announcement",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const botSessions = pgTable("bot_sessions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  lineUserId:    text("line_user_id").notNull().unique(),
  role:          text("role"),                            // manager | employee
  action:        text("action"),                          // action ปัจจุบัน เช่น 'create_task'
  state:         text("state").notNull().default("idle"), // idle | incomplete | pending_confirmation | confirmed
  collectedData: jsonb("collected_data").notNull().default({}),
  expiresAt:     timestamp("expires_at", { withTimezone: true }),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const menuActions = pgTable("menu_actions", {
  id:             serial("id").primaryKey(),
  role:           varchar("role", { length: 20 }).notNull(),   // manager | employee
  action:         varchar("action", { length: 50 }).notNull(),
  labelTh:        varchar("label_th", { length: 100 }).notNull(),
  description:    text("description").notNull(),
  requiredFields: jsonb("required_fields").notNull().default([]),
  optionalFields: jsonb("optional_fields").notNull().default([]),
  confirmRequired: boolean("confirm_required").notNull().default(true),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actionHandlers = pgTable("action_handlers", {
  id:          serial("id").primaryKey(),
  action:      varchar("action", { length: 50 }).notNull().unique(),
  webhookUrl:  text("webhook_url").notNull(),
  description: varchar("description", { length: 200 }),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiChatHistories = pgTable("ai_chat_histories", {
  id:         uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").references(() => employees.id),
  sessionId:  text("session_id").notNull(),
  role:       text("role").notNull(), // user | assistant | system
  content:    text("content").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const aiChatHistoriesRelations = relations(aiChatHistories, ({ one }) => ({
  employee: one(employees, { fields: [aiChatHistories.employeeId], references: [employees.id] }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type BotSession       = typeof botSessions.$inferSelect;
export type NewBotSession    = typeof botSessions.$inferInsert;
export type MenuAction       = typeof menuActions.$inferSelect;
export type NewMenuAction    = typeof menuActions.$inferInsert;
export type ActionHandler    = typeof actionHandlers.$inferSelect;
export type NewActionHandler = typeof actionHandlers.$inferInsert;
export type AiChatHistory    = typeof aiChatHistories.$inferSelect;
export type NewAiChatHistory = typeof aiChatHistories.$inferInsert;
