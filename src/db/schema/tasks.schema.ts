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
import { employees } from "./employees.schema.ts";
import { lists, listStatuses, taskTypes } from "./workspace.schema.ts";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum("task_status", [
  "pending", "in_progress", "paused", "review",
  "completed", "cancelled", "blocked", "overdue",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low", "normal", "high", "urgent",
]);

export const dueExtensionStatusEnum = pgEnum("due_extension_status", [
  "pending", "approved", "rejected",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const tasks = pgTable("tasks", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  displayId:          text("display_id").unique(),
  title:              text("title").notNull(),
  description:        text("description"),
  listId:             uuid("list_id").notNull().references(() => lists.id),
  listStatusId:       uuid("list_status_id").references(() => listStatuses.id),
  taskTypeId:         uuid("task_type_id").references(() => taskTypes.id),
  priority:           taskPriorityEnum("priority").notNull().default("normal"),
  assigneeId:         uuid("assignee_id").notNull().references(() => employees.id),
  creatorId:          uuid("creator_id").notNull().references(() => employees.id),
  clickupTaskId:      text("clickup_task_id").unique(),
  source:             text("source").notNull().default("manager_assigned"),
  storyPoints:        integer("story_points"),
  mandayEstimate:     numeric("manday_estimate"),
  timeEstimateHours:  numeric("time_estimate_hours"),
  accumulatedMinutes: integer("accumulated_minutes").notNull().default(0),
  actualHours:        numeric("actual_hours").notNull().default("0"),
  planStart:          date("plan_start"),
  durationDays:       integer("duration_days"),
  // planFinish = GENERATED ALWAYS AS (plan_start + (duration_days - 1)) STORED ใน DB — อย่า insert ค่านี้
  planFinish:         date("plan_finish"),
  deadline:           timestamp("deadline", { withTimezone: true }),
  startedAt:          timestamp("started_at", { withTimezone: true }),
  completedAt:        timestamp("completed_at", { withTimezone: true }),
  status:             taskStatusEnum("status").notNull().default("pending"),
  displayOrder:       integer("display_order").notNull().default(0),
  score:              numeric("score"),
  blockedNote:        text("blocked_note"),
  blockedAt:          timestamp("blocked_at", { withTimezone: true }),
  tags:               jsonb("tags").notNull().default([]),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subtasks = pgTable("subtasks", {
  id:           uuid("id").primaryKey().defaultRandom(),
  parentTaskId: uuid("parent_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title:        text("title").notNull(),
  isCompleted:  boolean("is_completed").notNull().default(false),
  assigneeId:   uuid("assignee_id").references(() => employees.id),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskTimeSessions = pgTable("task_time_sessions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  taskId:      uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  employeeId:  uuid("employee_id").notNull().references(() => employees.id),
  startedAt:   timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt:     timestamp("ended_at", { withTimezone: true }),
  // durationMin คำนวณจาก ended_at - started_at แล้ว handler update เอง
  durationMin: integer("duration_min"),
  note:        text("note"),
});

export const taskComments = pgTable("task_comments", {
  id:          uuid("id").primaryKey().defaultRandom(),
  taskId:      uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorId:    uuid("author_id").notNull().references(() => employees.id),
  commentText: text("comment_text").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }),
});

export const taskAttachments = pgTable("task_attachments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  taskId:          uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  uploadedBy:      uuid("uploaded_by").notNull().references(() => employees.id),
  fileUrl:         text("file_url").notNull(),
  fileName:        text("file_name"),
  fileDescription: text("file_description"),
  fileSizeBytes:   numeric("file_size_bytes"),
  mimeType:        text("mime_type"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dueExtensionRequests = pgTable("due_extension_requests", {
  id:           uuid("id").primaryKey().defaultRandom(),
  displayId:    text("display_id").unique(),
  taskId:       uuid("task_id").notNull().references(() => tasks.id),
  requestedBy:  uuid("requested_by").notNull().references(() => employees.id),
  reviewedBy:   uuid("reviewed_by").references(() => employees.id),
  newDeadline:  timestamp("new_deadline", { withTimezone: true }).notNull(),
  reason:       text("reason").notNull(),
  status:       dueExtensionStatusEnum("status").notNull().default("pending"),
  reviewedAt:   timestamp("reviewed_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  list:                one(lists,        { fields: [tasks.listId],       references: [lists.id] }),
  listStatus:          one(listStatuses, { fields: [tasks.listStatusId], references: [listStatuses.id] }),
  taskType:            one(taskTypes,    { fields: [tasks.taskTypeId],   references: [taskTypes.id] }),
  assignee:            one(employees,    { fields: [tasks.assigneeId],   references: [employees.id] }),
  creator:             one(employees,    { fields: [tasks.creatorId],    references: [employees.id] }),
  subtasks:            many(subtasks),
  timeSessions:        many(taskTimeSessions),
  comments:            many(taskComments),
  attachments:         many(taskAttachments),
  extensionRequests:   many(dueExtensionRequests),
}));

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  task:     one(tasks,     { fields: [subtasks.parentTaskId], references: [tasks.id] }),
  assignee: one(employees, { fields: [subtasks.assigneeId],  references: [employees.id] }),
}));

export const taskTimeSessionsRelations = relations(taskTimeSessions, ({ one }) => ({
  task:     one(tasks,     { fields: [taskTimeSessions.taskId],     references: [tasks.id] }),
  employee: one(employees, { fields: [taskTimeSessions.employeeId], references: [employees.id] }),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task:   one(tasks,     { fields: [taskComments.taskId],   references: [tasks.id] }),
  author: one(employees, { fields: [taskComments.authorId], references: [employees.id] }),
}));

export const taskAttachmentsRelations = relations(taskAttachments, ({ one }) => ({
  task:       one(tasks,     { fields: [taskAttachments.taskId],      references: [tasks.id] }),
  uploadedBy: one(employees, { fields: [taskAttachments.uploadedBy],  references: [employees.id] }),
}));

export const dueExtensionRequestsRelations = relations(dueExtensionRequests, ({ one }) => ({
  task:        one(tasks,     { fields: [dueExtensionRequests.taskId],      references: [tasks.id] }),
  requestedBy: one(employees, { fields: [dueExtensionRequests.requestedBy], references: [employees.id] }),
  reviewedBy:  one(employees, { fields: [dueExtensionRequests.reviewedBy],  references: [employees.id] }),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type Task                   = typeof tasks.$inferSelect;
export type NewTask                = typeof tasks.$inferInsert;
export type Subtask                = typeof subtasks.$inferSelect;
export type NewSubtask             = typeof subtasks.$inferInsert;
export type TaskTimeSession        = typeof taskTimeSessions.$inferSelect;
export type NewTaskTimeSession     = typeof taskTimeSessions.$inferInsert;
export type TaskComment            = typeof taskComments.$inferSelect;
export type NewTaskComment         = typeof taskComments.$inferInsert;
export type TaskAttachment         = typeof taskAttachments.$inferSelect;
export type NewTaskAttachment      = typeof taskAttachments.$inferInsert;
export type DueExtensionRequest    = typeof dueExtensionRequests.$inferSelect;
export type NewDueExtensionRequest = typeof dueExtensionRequests.$inferInsert;
