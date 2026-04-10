import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { employees } from "./employees.schema.ts";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const statusTypeEnum = pgEnum("status_type", [
  "open", "in_progress", "review", "done", "closed",
]);

export const taskCategoryEnum = pgEnum("task_category", [
  "private", "organization",
]);

// ── Tables ────────────────────────────────────────────────────────────────────

export const spaces = pgTable("spaces", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  color:        text("color").notNull().default("#3b82f6"),
  icon:         text("icon"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const spaceMembers = pgTable("space_members", {
  id:         uuid("id").primaryKey().defaultRandom(),
  spaceId:    uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  joinedAt:   timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const folders = pgTable("folders", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  spaceId:      uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  color:        text("color"),
  displayOrder: integer("display_order").notNull().default(0),
  isArchived:   boolean("is_archived").notNull().default(false),
  archivedAt:   timestamp("archived_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lists = pgTable("lists", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  folderId:     uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
  spaceId:      uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  color:        text("color"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listStatuses = pgTable("list_statuses", {
  id:           uuid("id").primaryKey().defaultRandom(),
  listId:       uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  name:         text("name").notNull(),
  color:        text("color").notNull().default("#6b7280"),
  displayOrder: integer("display_order").notNull().default(0),
  type:         statusTypeEnum("type").notNull().default("open"),
});

export const taskTypes = pgTable("task_types", {
  id:              uuid("id").primaryKey().defaultRandom(),
  name:            text("name").notNull(),
  description:     text("description"),
  color:           text("color").notNull().default("#6b7280"),
  category:        taskCategoryEnum("category").notNull().default("organization"),
  countsForPoints: boolean("counts_for_points").notNull().default(true),
  fixedPoints:     integer("fixed_points"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations ─────────────────────────────────────────────────────────────────

export const spacesRelations = relations(spaces, ({ many }) => ({
  members: many(spaceMembers),
  folders: many(folders),
  lists:   many(lists),
}));

export const spaceMembersRelations = relations(spaceMembers, ({ one }) => ({
  space:    one(spaces,    { fields: [spaceMembers.spaceId],    references: [spaces.id] }),
  employee: one(employees, { fields: [spaceMembers.employeeId], references: [employees.id] }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  space: one(spaces, { fields: [folders.spaceId], references: [spaces.id] }),
  lists: many(lists),
}));

export const listsRelations = relations(lists, ({ one, many }) => ({
  space:    one(spaces,   { fields: [lists.spaceId],  references: [spaces.id] }),
  folder:   one(folders,  { fields: [lists.folderId], references: [folders.id] }),
  statuses: many(listStatuses),
}));

export const listStatusesRelations = relations(listStatuses, ({ one }) => ({
  list: one(lists, { fields: [listStatuses.listId], references: [lists.id] }),
}));

export const taskTypesRelations = relations(taskTypes, ({ many }) => ({
  // tasks relation จะ define ใน tasks.schema.ts เพื่อหลีกเลี่ยง circular import
}));

// ── Types ─────────────────────────────────────────────────────────────────────

export type Space         = typeof spaces.$inferSelect;
export type NewSpace      = typeof spaces.$inferInsert;
export type SpaceMember   = typeof spaceMembers.$inferSelect;
export type NewSpaceMember = typeof spaceMembers.$inferInsert;
export type Folder        = typeof folders.$inferSelect;
export type NewFolder     = typeof folders.$inferInsert;
export type List          = typeof lists.$inferSelect;
export type NewList       = typeof lists.$inferInsert;
export type ListStatus    = typeof listStatuses.$inferSelect;
export type NewListStatus = typeof listStatuses.$inferInsert;
export type TaskType      = typeof taskTypes.$inferSelect;
export type NewTaskType   = typeof taskTypes.$inferInsert;
