import { eq, and, sql, asc, desc, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import {
  tasks,
  subtasks,
  taskTimeSessions,
  taskComments,
  taskAttachments,
  dueExtensionRequests,
  taskReworkEvents,
} from "@/db/schema/tasks.schema.ts";
import { employees } from "@/db/schema/employees.schema.ts";
import { lists, listStatuses } from "@/db/schema/workspace.schema.ts";
import type {
  CreateTaskInput,
  UpdateTaskInput,
  UpdateTaskStatusInput,
  ReorderTasksInput,
  CreateSubtaskInput,
  UpdateSubtaskInput,
  CreateCommentInput,
  UpdateCommentInput,
  CreateExtensionInput,
} from "@/validators/task.validator.ts";

// ── Task CRUD ─────────────────────────────────────────────────────────────────

export const taskRepository = {
  async findAll(params: {
    listId: string;
    statusId?: string | undefined;
    assigneeId?: string | undefined;
    priority?: string | undefined;
    search?: string | undefined;
    page: number;
    limit: number;
    sort: string;
  }) {
    const { listId, statusId, assigneeId, priority, search, page, limit, sort } = params;
    const offset = (page - 1) * limit;

    const sortMap: Record<string, string> = {
      display_order: "t.display_order ASC",
      deadline:      "t.deadline ASC NULLS LAST",
      created_at:    "t.created_at DESC",
      priority:      "CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END ASC",
    };
    const orderClause = sortMap[sort] ?? "t.display_order ASC";

    // Build dynamic WHERE conditions
    const conditions: string[] = ["t.deleted_at IS NULL", `t.list_id = '${listId}'::uuid`];
    if (statusId)   conditions.push(`t.list_status_id = '${statusId}'::uuid`);
    if (assigneeId) conditions.push(`t.assignee_id = '${assigneeId}'::uuid`);
    if (priority)   conditions.push(`t.priority = '${priority}'`);
    if (search && search.length <= 200) conditions.push(`t.title ILIKE '%${search.replace(/\\/g, "\\\\").replace(/'/g, "''")}%'`);

    const whereClause = conditions.join(" AND ");

    const dataRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.id, t.display_id, t.title, t.description, t.list_id, t.list_status_id,
        t.task_type_id, t.priority, t.assignee_id, t.creator_id, t.source,
        t.story_points, t.manday_estimate, t.time_estimate_hours,
        t.accumulated_minutes, t.actual_hours,
        t.plan_start, t.duration_days, t.plan_finish, t.deadline,
        t.started_at, t.completed_at, t.status, t.display_order,
        t.score, t.estimate_progress, t.blocked_note, t.blocked_at, t.tags,
        t.created_at, t.updated_at,
        ls.name AS status_name, ls.color AS status_color, ls.type AS status_type,
        a.name AS assignee_name, a.avatar_url AS assignee_avatar,
        cr.name AS creator_name,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) AS subtask_count,
        (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) AS comment_count,
        (SELECT COUNT(*) FROM task_attachments WHERE task_id = t.id) AS attachment_count
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      LEFT JOIN employees a ON t.assignee_id = a.id
      LEFT JOIN employees cr ON t.creator_id = cr.id
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      LIMIT ${limit} OFFSET ${offset}
    `));

    const countRows = await db.execute<{ total: string }>(sql.raw(`
      SELECT COUNT(*) AS total FROM tasks t WHERE ${whereClause}
    `));

    return {
      data:  dataRows as unknown[],
      total: Number(countRows[0]?.total ?? 0),
    };
  },

  async findMy(userId: string, range?: string) {
    let rangeCondition = "";
    if (range === "today") {
      rangeCondition = "AND t.deadline::date = CURRENT_DATE";
    } else if (range === "week") {
      rangeCondition = "AND t.deadline BETWEEN NOW() AND NOW() + INTERVAL '7 days'";
    } else if (range === "month") {
      rangeCondition = "AND t.deadline BETWEEN NOW() AND NOW() + INTERVAL '30 days'";
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.id, t.display_id, t.title, t.list_id, t.list_status_id, t.task_type_id,
        t.priority, t.assignee_id, t.creator_id, t.source,
        t.story_points, t.manday_estimate, t.time_estimate_hours,
        t.accumulated_minutes, t.actual_hours,
        t.plan_start, t.duration_days, t.plan_finish, t.deadline,
        t.started_at, t.completed_at, t.status, t.display_order,
        t.score, t.estimate_progress, t.blocked_note, t.blocked_at, t.tags,
        t.created_at, t.updated_at,
        ls.name AS status_name, ls.color AS status_color,
        l.name AS list_name
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      LEFT JOIN lists l ON t.list_id = l.id
      WHERE t.assignee_id = '${userId}'::uuid
        AND t.status NOT IN ('completed','cancelled')
        AND t.deleted_at IS NULL
        ${rangeCondition}
      ORDER BY t.deadline ASC NULLS LAST
    `));

    return rows as unknown[];
  },

  async findCalendar(userId: string, role: string, start: string, end: string) {
    let employeeFilter = "";
    if (role === "employee") {
      employeeFilter = `AND t.assignee_id = '${userId}'::uuid`;
    } else if (role === "manager") {
      employeeFilter = `AND t.assignee_id IN (SELECT id FROM employees WHERE manager_id = '${userId}'::uuid)`;
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.id, t.display_id, t.title, t.list_id, t.list_status_id,
        t.task_type_id,
        t.priority, t.assignee_id, t.status,
        t.plan_start, t.duration_days, t.plan_finish, t.deadline,
        t.tags, t.story_points, t.created_at,
        t.accumulated_minutes, t.time_estimate_hours,
        a.name AS assignee_name, a.avatar_url AS assignee_avatar,
        ls.name AS status_name, ls.color AS status_color, ls.type AS status_type,
        tt.name AS task_type_name, tt.color AS task_type_color,
        l.name AS list_name
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      LEFT JOIN task_types tt ON t.task_type_id = tt.id
      LEFT JOIN lists l ON t.list_id = l.id
      LEFT JOIN employees a ON t.assignee_id = a.id
      WHERE (
        (t.deadline::date BETWEEN '${start}' AND '${end}')
        OR (t.plan_start BETWEEN '${start}' AND '${end}')
      )
        AND t.deleted_at IS NULL
        ${employeeFilter}
      ORDER BY t.deadline ASC NULLS LAST, t.plan_start ASC NULLS LAST
    `));

    return rows as unknown[];
  },

  async findById(id: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.id, t.display_id, t.title, t.description, t.list_id, t.list_status_id,
        t.task_type_id, t.priority, t.assignee_id, t.creator_id,
        t.clickup_task_id, t.source,
        t.story_points, t.manday_estimate, t.time_estimate_hours,
        t.accumulated_minutes, t.actual_hours,
        t.plan_start, t.duration_days, t.plan_finish, t.deadline,
        t.started_at, t.completed_at, t.status, t.display_order,
        t.score, t.estimate_progress, t.blocked_note, t.blocked_at, t.tags,
        t.created_at, t.updated_at,
        ls.id AS status_id, ls.name AS status_name, ls.color AS status_color, ls.type AS status_type,
        a.id AS assignee_id_ref, a.name AS assignee_name, a.avatar_url AS assignee_avatar,
        a.employee_code AS assignee_code,
        cr.id AS creator_id_ref, cr.name AS creator_name, cr.avatar_url AS creator_avatar,
        l.name AS list_name, l.space_id,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) AS subtask_count,
        (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND is_done = true) AS subtask_done_count,
        (SELECT COUNT(*) FROM task_comments WHERE task_id = t.id) AS comment_count,
        (SELECT COUNT(*) FROM task_attachments WHERE task_id = t.id) AS attachment_count
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      LEFT JOIN employees a ON t.assignee_id = a.id
      LEFT JOIN employees cr ON t.creator_id = cr.id
      LEFT JOIN lists l ON t.list_id = l.id
      WHERE t.id = '${id}'::uuid AND t.deleted_at IS NULL
    `));
    return rows[0] ?? null;
  },

  async create(data: CreateTaskInput, creatorId: string) {
    // Get next display_id
    const displayIdRows = await db.execute<{ display_id: string }>(sql`
      SELECT 'TK-' || LPAD(nextval('task_display_seq')::text, 6, '0') AS display_id
    `);
    const displayId = displayIdRows[0]?.display_id;

    // Build insert columns and values
    const cols: string[] = [
      "display_id", "title", "list_id", "assignee_id", "creator_id",
      "priority", "source", "tags", "status",
    ];
    const vals: string[] = [
      `'${displayId}'`,
      `'${data.title.replace(/'/g, "''")}'`,
      `'${data.listId}'::uuid`,
      `'${data.assigneeId}'::uuid`,
      `'${creatorId}'::uuid`,
      `'${data.priority ?? "normal"}'`,
      `'${(data.source ?? "manager_assigned").replace(/'/g, "''")}'`,
      `'${JSON.stringify(data.tags ?? [])}'::jsonb`,
      `'pending'`,
    ];

    if (data.listStatusId)      { cols.push("list_status_id");       vals.push(`'${data.listStatusId}'::uuid`); }
    if (data.taskTypeId)        { cols.push("task_type_id");         vals.push(`'${data.taskTypeId}'::uuid`); }
    if (data.description)       { cols.push("description");          vals.push(`'${data.description.replace(/'/g, "''")}'`); }
    if (data.storyPoints != null)       { cols.push("story_points");         vals.push(`${data.storyPoints}`); }
    if (data.mandayEstimate != null)    { cols.push("manday_estimate");      vals.push(`${data.mandayEstimate}`); }
    if (data.timeEstimateHours != null) { cols.push("time_estimate_hours");  vals.push(`${data.timeEstimateHours}`); }
    if (data.planStart)         { cols.push("plan_start");           vals.push(`'${data.planStart}'`); }
    if (data.planFinish)        { cols.push("plan_finish");          vals.push(`'${data.planFinish}'`); }
    if (data.durationDays != null) { cols.push("duration_days");    vals.push(`${data.durationDays}`); }
    if (data.deadline)          { cols.push("deadline");             vals.push(`'${data.deadline}'::timestamptz`); }

    // Get current max display_order for this list
    const maxOrderRows = await db.execute<{ max_order: string }>(sql.raw(`
      SELECT COALESCE(MAX(display_order), 0) AS max_order FROM tasks
      WHERE list_id = '${data.listId}'::uuid AND deleted_at IS NULL
    `));
    const nextOrder = Number(maxOrderRows[0]?.max_order ?? 0) + 1;
    cols.push("display_order");
    vals.push(`${nextOrder}`);

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO tasks (${cols.join(", ")})
      VALUES (${vals.join(", ")})
      RETURNING *
    `));
    return rows[0];
  },

  async update(id: string, data: UpdateTaskInput) {
    const sets: string[] = ["updated_at = now()"];

    if (data.title !== undefined)             sets.push(`title = '${data.title.replace(/'/g, "''")}'`);
    if (data.listStatusId !== undefined)      sets.push(data.listStatusId ? `list_status_id = '${data.listStatusId}'::uuid` : "list_status_id = NULL");
    if (data.taskTypeId !== undefined)        sets.push(data.taskTypeId ? `task_type_id = '${data.taskTypeId}'::uuid` : "task_type_id = NULL");
    if (data.priority !== undefined)          sets.push(`priority = '${data.priority}'`);
    if (data.assigneeId !== undefined)        sets.push(`assignee_id = '${data.assigneeId}'::uuid`);
    if (data.storyPoints !== undefined)       sets.push(data.storyPoints != null ? `story_points = ${data.storyPoints}` : "story_points = NULL");
    if (data.mandayEstimate !== undefined)    sets.push(data.mandayEstimate != null ? `manday_estimate = ${data.mandayEstimate}` : "manday_estimate = NULL");
    if (data.timeEstimateHours !== undefined) sets.push(data.timeEstimateHours != null ? `time_estimate_hours = ${data.timeEstimateHours}` : "time_estimate_hours = NULL");
    if (data.planStart !== undefined)         sets.push(data.planStart ? `plan_start = '${data.planStart}'` : "plan_start = NULL");
    if (data.planFinish !== undefined)        sets.push(data.planFinish ? `plan_finish = '${data.planFinish}'` : "plan_finish = NULL");
    if (data.durationDays !== undefined)      sets.push(data.durationDays != null ? `duration_days = ${data.durationDays}` : "duration_days = NULL");
    if (data.deadline !== undefined)          sets.push(data.deadline ? `deadline = '${data.deadline}'::timestamptz` : "deadline = NULL");
    if (data.description !== undefined)       sets.push(data.description != null ? `description = '${data.description.replace(/'/g, "''")}'` : "description = NULL");
    if (data.tags !== undefined)              sets.push(`tags = '${JSON.stringify(data.tags)}'::jsonb`);
    if (data.estimateProgress !== undefined) {
      sets.push(data.estimateProgress != null ? `estimate_progress = ${data.estimateProgress}` : "estimate_progress = NULL");
      // Auto-set completed_at when estimate_progress = 100
      if (data.estimateProgress === 100) {
        sets.push("completed_at = COALESCE(completed_at, now())");
      }
    }
    if (data.blockedNote !== undefined)       sets.push(data.blockedNote != null ? `blocked_note = '${data.blockedNote.replace(/'/g, "''")}'` : "blocked_note = NULL");
    if (data.startedAt !== undefined)         sets.push(data.startedAt ? `started_at = '${data.startedAt}'::timestamptz` : "started_at = NULL");
    if (data.completedAt !== undefined)       sets.push(data.completedAt ? `completed_at = '${data.completedAt}'::timestamptz` : "completed_at = NULL");
    if (data.accumulatedMinutes !== undefined) sets.push(`accumulated_minutes = accumulated_minutes + ${data.accumulatedMinutes}`);

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE tasks SET ${sets.join(", ")}
      WHERE id = '${id}'::uuid AND deleted_at IS NULL
      RETURNING *
    `));
    return rows[0] ?? null;
  },

  async updateStatus(id: string, data: { listStatusId: string; status?: string }) {
    // Map frontend status types to database enum values
    const statusMap: Record<string, string> = {
      "done": "completed",
      "closed": "cancelled",
      "open": "pending",
    };
    
    const mappedStatus = data.status ? (statusMap[data.status] || data.status) : undefined;
    
    const sets: string[] = [
      `list_status_id = '${data.listStatusId}'::uuid`,
      "updated_at = now()",
    ];

    if (mappedStatus) {
      sets.push(`status = '${mappedStatus}'`);
      if (mappedStatus === "in_progress") {
        sets.push("started_at = COALESCE(started_at, now())");
      }
      if (mappedStatus === "completed") {
        sets.push("completed_at = COALESCE(completed_at, now())");
      }
      if (mappedStatus === "blocked") {
        sets.push("blocked_at = COALESCE(blocked_at, now())");
      }
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE tasks SET ${sets.join(", ")}
      WHERE id = '${id}'::uuid AND deleted_at IS NULL
      RETURNING *
    `));
    return rows[0] ?? null;
  },

  async reorder(listId: string, statusId: string, orderedTaskIds: string[]) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedTaskIds.length; i++) {
        await tx.execute(sql.raw(`
          UPDATE tasks
          SET display_order = ${i + 1}, updated_at = now()
          WHERE id = '${orderedTaskIds[i]}'::uuid
            AND list_id = '${listId}'::uuid
            AND list_status_id = '${statusId}'::uuid
            AND deleted_at IS NULL
        `));
      }
    });
  },

  async softDelete(id: string) {
    await db.execute(sql.raw(`
      UPDATE tasks
      SET deleted_at = now(), status = 'cancelled', updated_at = now()
      WHERE id = '${id}'::uuid AND deleted_at IS NULL
    `));
  },

  async findTasksByListAndStatus(listId: string, statusId: string) {
    const rows = await db.execute<{ id: string }>(sql.raw(`
      SELECT id FROM tasks
      WHERE list_id = '${listId}'::uuid
        AND list_status_id = '${statusId}'::uuid
        AND deleted_at IS NULL
    `));
    return rows.map(r => r.id);
  },

  // ── Subtasks ──────────────────────────────────────────────────────────────────

  async findSubtasks(taskId: string) {
    return db
      .select({
        id:            subtasks.id,
        taskId:        subtasks.taskId,
        title:         subtasks.title,
        isDone:        subtasks.isDone,
        doneAt:        subtasks.doneAt,
        doneBy:        subtasks.doneBy,
        orderIndex:    subtasks.orderIndex,
        createdBy:     subtasks.createdBy,
        createdAt:     subtasks.createdAt,
        updatedAt:     subtasks.updatedAt,
        doneByName:    employees.name,
        doneByAvatar:  employees.avatarUrl,
      })
      .from(subtasks)
      .leftJoin(employees, eq(subtasks.doneBy, employees.id))
      .where(eq(subtasks.taskId, taskId))
      .orderBy(asc(subtasks.orderIndex), asc(subtasks.createdAt));
  },

  async findSubtaskById(id: string) {
    return db.query.subtasks.findFirst({
      where: eq(subtasks.id, id),
    });
  },

  async createSubtask(taskId: string, data: CreateSubtaskInput, userId: string) {
    const maxOrderResult = await db
      .select({ max: sql<number>`COALESCE(MAX(order_index), 0)`.mapWith(Number) })
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId));
    const nextOrder = (maxOrderResult[0]?.max ?? 0) + 1;

    const [subtask] = await db
      .insert(subtasks)
      .values({
        taskId,
        title:      data.title,
        orderIndex: nextOrder,
        createdBy:  userId,
      })
      .returning();
    return subtask;
  },

  async updateSubtask(id: string, data: UpdateSubtaskInput, userId: string) {
    const setData: Record<string, unknown> = {};
    if (data.title !== undefined)       setData.title      = data.title;
    if (data.orderIndex !== undefined)  setData.orderIndex = data.orderIndex;
    if (data.isDone !== undefined) {
      setData.isDone = data.isDone;
      if (data.isDone) setData.doneBy = userId;
    }
    const [subtask] = await db
      .update(subtasks)
      .set(setData)
      .where(eq(subtasks.id, id))
      .returning();
    return subtask ?? null;
  },

  async toggleSubtask(id: string, userId: string) {
    const current = await db.query.subtasks.findFirst({ where: eq(subtasks.id, id) });
    if (!current) return null;
    const nextDone = !current.isDone;
    const [subtask] = await db
      .update(subtasks)
      .set({ isDone: nextDone, doneBy: nextDone ? userId : null })
      .where(eq(subtasks.id, id))
      .returning();
    return subtask ?? null;
  },

  async deleteSubtask(id: string) {
    await db.delete(subtasks).where(eq(subtasks.id, id));
  },

  async reorderSubtasks(taskId: string, orderedIds: string[]) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const id = orderedIds[i]!;
        await tx
          .update(subtasks)
          .set({ orderIndex: i + 1 })
          .where(and(eq(subtasks.id, id), eq(subtasks.taskId, taskId)));
      }
    });
  },

  // ── Comments ──────────────────────────────────────────────────────────────────

  async findComments(taskId: string) {
    return db
      .select({
        id:          taskComments.id,
        taskId:      taskComments.taskId,
        authorId:    taskComments.authorId,
        commentText: taskComments.commentText,
        createdAt:   taskComments.createdAt,
        updatedAt:   taskComments.updatedAt,
        authorName:   employees.name,
        authorAvatar: employees.avatarUrl,
      })
      .from(taskComments)
      .leftJoin(employees, eq(taskComments.authorId, employees.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt));
  },

  async findCommentById(id: string) {
    return db.query.taskComments.findFirst({
      where: eq(taskComments.id, id),
    });
  },

  async createComment(taskId: string, authorId: string, data: CreateCommentInput) {
    const [comment] = await db
      .insert(taskComments)
      .values({ taskId, authorId, commentText: data.commentText })
      .returning();
    
    if (!comment) {
      throw new Error("Failed to create comment");
    }
    
    // Return comment with author info
    const [result] = await db
      .select({
        id:          taskComments.id,
        taskId:      taskComments.taskId,
        authorId:    taskComments.authorId,
        commentText: taskComments.commentText,
        createdAt:   taskComments.createdAt,
        updatedAt:   taskComments.updatedAt,
        authorName:   employees.name,
        authorAvatar: employees.avatarUrl,
      })
      .from(taskComments)
      .leftJoin(employees, eq(taskComments.authorId, employees.id))
      .where(eq(taskComments.id, comment.id));
    
    if (!result) {
      throw new Error("Failed to fetch created comment");
    }
    
    return result;
  },

  async updateComment(id: string, data: UpdateCommentInput) {
    const [comment] = await db
      .update(taskComments)
      .set({ commentText: data.commentText, updatedAt: sql`now()` })
      .where(eq(taskComments.id, id))
      .returning();
    
    if (!comment) return null;
    
    // Return comment with author info
    const [result] = await db
      .select({
        id:          taskComments.id,
        taskId:      taskComments.taskId,
        authorId:    taskComments.authorId,
        commentText: taskComments.commentText,
        createdAt:   taskComments.createdAt,
        updatedAt:   taskComments.updatedAt,
        authorName:   employees.name,
        authorAvatar: employees.avatarUrl,
      })
      .from(taskComments)
      .leftJoin(employees, eq(taskComments.authorId, employees.id))
      .where(eq(taskComments.id, id));
    
    return result ?? null;
  },

  async deleteComment(id: string) {
    await db.delete(taskComments).where(eq(taskComments.id, id));
  },

  // ── Time Tracking ─────────────────────────────────────────────────────────────

  async findRunningSession(employeeId: string) {
    return db.query.taskTimeSessions.findFirst({
      where: and(
        eq(taskTimeSessions.employeeId, employeeId),
        isNull(taskTimeSessions.endedAt)
      ),
    });
  },

  async startSession(taskId: string, employeeId: string) {
    const [session] = await db
      .insert(taskTimeSessions)
      .values({ taskId, employeeId })
      .returning();
    return session;
  },

  async closeRunningSession(taskId: string, employeeId: string) {
    // Close session and update accumulated minutes
    const rows = await db.execute<{ duration_min: string }>(sql.raw(`
      UPDATE task_time_sessions
      SET
        ended_at     = now(),
        duration_min = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int / 60)
      WHERE task_id    = '${taskId}'::uuid
        AND employee_id = '${employeeId}'::uuid
        AND ended_at IS NULL
      RETURNING duration_min
    `));

    const durationMin = Number(rows[0]?.duration_min ?? 0);
    if (durationMin > 0) {
      await db.execute(sql.raw(`
        UPDATE tasks
        SET
          accumulated_minutes = accumulated_minutes + ${durationMin},
          actual_hours        = ROUND((accumulated_minutes + ${durationMin})::numeric / 60, 2),
          updated_at          = now()
        WHERE id = '${taskId}'::uuid
      `));
    }
    return durationMin;
  },

  async logTimeManual(taskId: string, employeeId: string, durationMin: number, note?: string, startedAt?: Date) {
    const start = startedAt ?? new Date();
    const end   = new Date(start.getTime() + durationMin * 60_000);
    const [session] = await db
      .insert(taskTimeSessions)
      .values({
        taskId,
        employeeId,
        startedAt: start,
        endedAt:   end,
        durationMin,
        note:      note ?? null,
      })
      .returning();

    await db.execute(sql.raw(`
      UPDATE tasks
      SET
        accumulated_minutes = accumulated_minutes + ${durationMin},
        actual_hours        = ROUND((accumulated_minutes + ${durationMin})::numeric / 60, 2),
        updated_at          = now()
      WHERE id = '${taskId}'::uuid
    `));

    return session;
  },

  async findTimeSessionById(id: string) {
    return db.query.taskTimeSessions.findFirst({
      where: eq(taskTimeSessions.id, id),
    });
  },

  async deleteTimeSession(id: string) {
    const session = await db.query.taskTimeSessions.findFirst({
      where: eq(taskTimeSessions.id, id),
    });
    if (!session) return null;
    const dur = session.durationMin ?? 0;
    await db.delete(taskTimeSessions).where(eq(taskTimeSessions.id, id));
    if (dur > 0) {
      await db.execute(sql.raw(`
        UPDATE tasks
        SET
          accumulated_minutes = GREATEST(0, accumulated_minutes - ${dur}),
          actual_hours        = ROUND(GREATEST(0, accumulated_minutes - ${dur})::numeric / 60, 2),
          updated_at          = now()
        WHERE id = '${session.taskId}'::uuid
      `));
    }
    return session;
  },

  async findTimeSessions(taskId: string) {
    return db
      .select({
        id:          taskTimeSessions.id,
        taskId:      taskTimeSessions.taskId,
        employeeId:  taskTimeSessions.employeeId,
        startedAt:   taskTimeSessions.startedAt,
        endedAt:     taskTimeSessions.endedAt,
        durationMin: taskTimeSessions.durationMin,
        note:        taskTimeSessions.note,
        employeeName:   employees.name,
        employeeAvatar: employees.avatarUrl,
      })
      .from(taskTimeSessions)
      .leftJoin(employees, eq(taskTimeSessions.employeeId, employees.id))
      .where(eq(taskTimeSessions.taskId, taskId))
      .orderBy(desc(taskTimeSessions.startedAt));
  },

  // ── Extension Requests ────────────────────────────────────────────────────────

  async findExtensionRequests(taskId: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        er.id, er.display_id, er.task_id, er.requested_by, er.reviewed_by,
        er.new_deadline, er.reason, er.status, er.reviewed_at, er.reject_reason,
        er.created_at,
        req.name AS requester_name, req.avatar_url AS requester_avatar,
        rev.name AS reviewer_name, rev.avatar_url AS reviewer_avatar
      FROM due_extension_requests er
      LEFT JOIN employees req ON er.requested_by = req.id
      LEFT JOIN employees rev ON er.reviewed_by = rev.id
      WHERE er.task_id = '${taskId}'::uuid
      ORDER BY er.created_at DESC
    `));
    return rows as unknown[];
  },

  async findExtensionById(id: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        er.id, er.display_id, er.task_id, er.requested_by, er.reviewed_by,
        er.new_deadline, er.reason, er.status, er.reviewed_at, er.reject_reason,
        er.created_at,
        req.name AS requester_name, req.avatar_url AS requester_avatar,
        rev.name AS reviewer_name, rev.avatar_url AS reviewer_avatar,
        t.title AS task_title, t.deadline AS task_deadline, t.display_id AS task_display_id
      FROM due_extension_requests er
      LEFT JOIN employees req ON er.requested_by = req.id
      LEFT JOIN employees rev ON er.reviewed_by = rev.id
      LEFT JOIN tasks t ON er.task_id = t.id
      WHERE er.id = '${id}'::uuid
    `));
    return rows[0] ?? null;
  },

  async findPendingExtensionForTask(taskId: string) {
    return db.query.dueExtensionRequests.findFirst({
      where: and(
        eq(dueExtensionRequests.taskId, taskId),
        eq(dueExtensionRequests.status, "pending")
      ),
    });
  },

  async listExtensionRequests(status?: string, userId?: string, role?: string) {
    let whereClause = "1=1";
    if (status) whereClause += ` AND er.status = '${status}'`;
    if (role === "employee" && userId) whereClause += ` AND er.requested_by = '${userId}'::uuid`;
    if (role === "manager" && userId) {
      // manager เห็น extension ของ task ที่ assignee อยู่ในทีม
      whereClause += ` AND t.assignee_id IN (SELECT id FROM employees WHERE manager_id = '${userId}'::uuid)`;
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        er.id, er.display_id, er.task_id, er.requested_by, er.reviewed_by,
        er.new_deadline, er.reason, er.status, er.reviewed_at, er.reject_reason,
        er.created_at,
        req.name AS requester_name, req.avatar_url AS requester_avatar,
        rev.name AS reviewer_name, rev.avatar_url AS reviewer_avatar,
        t.title AS task_title, t.deadline AS task_deadline, t.display_id AS task_display_id
      FROM due_extension_requests er
      LEFT JOIN employees req ON er.requested_by = req.id
      LEFT JOIN employees rev ON er.reviewed_by = rev.id
      LEFT JOIN tasks t ON er.task_id = t.id
      WHERE ${whereClause}
      ORDER BY er.created_at DESC
    `));
    return rows as unknown[];
  },

  async createExtensionRequest(taskId: string, requestedBy: string, data: CreateExtensionInput) {
    const displayIdRows = await db.execute<{ display_id: string }>(sql`
      SELECT 'EX-' || LPAD(nextval('extension_display_seq')::text, 6, '0') AS display_id
    `);
    const displayId = displayIdRows[0]?.display_id;
    const reason = data.reason.replace(/'/g, "''");

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO due_extension_requests (display_id, task_id, requested_by, new_deadline, reason)
      VALUES ('${displayId}', '${taskId}'::uuid, '${requestedBy}'::uuid, '${data.newDeadline}'::timestamptz, '${reason}')
      RETURNING *
    `));
    return rows[0];
  },

  async approveExtension(id: string, reviewedBy: string) {
    // Update the extension request to approved
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE due_extension_requests
      SET status = 'approved', reviewed_by = '${reviewedBy}'::uuid, reviewed_at = now()
      WHERE id = '${id}'::uuid
      RETURNING *
    `));
    const ext = rows[0] as { task_id: string; new_deadline: string } | undefined;

    // Update the task deadline
    if (ext) {
      await db.execute(sql.raw(`
        UPDATE tasks
        SET deadline = '${ext.new_deadline}'::timestamptz, updated_at = now()
        WHERE id = '${ext.task_id}'::uuid
      `));
    }
    return ext ?? null;
  },

  async rejectExtension(id: string, reviewedBy: string, rejectReason: string) {
    const reason = rejectReason.replace(/'/g, "''");
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE due_extension_requests
      SET status = 'rejected', reviewed_by = '${reviewedBy}'::uuid, reviewed_at = now(), reject_reason = '${reason}'
      WHERE id = '${id}'::uuid
      RETURNING *
    `));
    return rows[0] ?? null;
  },

  // ── Attachments ───────────────────────────────────────────────────────────────

  async findAttachments(taskId: string) {
    return db
      .select({
        id:              taskAttachments.id,
        taskId:          taskAttachments.taskId,
        uploadedBy:      taskAttachments.uploadedBy,
        fileUrl:         taskAttachments.fileUrl,
        fileName:        taskAttachments.fileName,
        fileDescription: taskAttachments.fileDescription,
        fileSizeBytes:   taskAttachments.fileSizeBytes,
        mimeType:        taskAttachments.mimeType,
        createdAt:       taskAttachments.createdAt,
        uploaderName:    employees.name,
        uploaderAvatar:  employees.avatarUrl,
      })
      .from(taskAttachments)
      .leftJoin(employees, eq(taskAttachments.uploadedBy, employees.id))
      .where(eq(taskAttachments.taskId, taskId))
      .orderBy(desc(taskAttachments.createdAt));
  },

  async createAttachment(
    taskId: string,
    uploadedBy: string,
    fileData: {
      fileUrl: string;
      fileName?: string;
      fileDescription?: string;
      fileSizeBytes?: number;
      mimeType?: string;
    }
  ) {
    const [attachment] = await db
      .insert(taskAttachments)
      .values({
        taskId,
        uploadedBy,
        fileUrl:         fileData.fileUrl,
        fileName:        fileData.fileName ?? null,
        fileDescription: fileData.fileDescription ?? null,
        fileSizeBytes:   fileData.fileSizeBytes?.toString() ?? null,
        mimeType:        fileData.mimeType ?? null,
      })
      .returning();
    return attachment;
  },

  async findAttachmentById(id: string) {
    return db.query.taskAttachments.findFirst({
      where: eq(taskAttachments.id, id),
    });
  },

  async deleteAttachment(id: string) {
    await db.delete(taskAttachments).where(eq(taskAttachments.id, id));
  },

  // ── Search ────────────────────────────────────────────────────────────────────

  async search(q: string, types: string[], limit: number, userId: string, role: string) {
    const escaped = q.replace(/\\/g, "\\\\").replace(/'/g, "''");
    const results: { type: string; items: unknown[] }[] = [];

    if (types.includes("task")) {
      let employeeFilter = "";
      if (role === "employee") {
        employeeFilter = `AND t.assignee_id = '${userId}'::uuid`;
      } else if (role === "manager") {
        employeeFilter = `AND t.assignee_id IN (SELECT id FROM employees WHERE manager_id = '${userId}'::uuid)`;
      }

      const rows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT
          'task' AS type,
          t.id, t.display_id, t.title, t.priority, t.status,
          t.deadline, t.list_id, t.assignee_id,
          a.name AS assignee_name,
          l.name AS list_name
        FROM tasks t
        LEFT JOIN employees a ON t.assignee_id = a.id
        LEFT JOIN lists l ON t.list_id = l.id
        WHERE t.title ILIKE '%${escaped}%'
          AND t.deleted_at IS NULL
          ${employeeFilter}
        ORDER BY t.updated_at DESC
        LIMIT ${limit}
      `));
      results.push({ type: "task", items: rows as unknown[] });
    }

    if (types.includes("employee")) {
      const rows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT
          'employee' AS type,
          e.id, e.employee_code, e.name, e.email, e.avatar_url, e.role, e.department
        FROM employees e
        WHERE (e.name ILIKE '%${escaped}%' OR e.employee_code ILIKE '%${escaped}%')
          AND e.is_active = true
        ORDER BY e.name ASC
        LIMIT ${limit}
      `));
      results.push({ type: "employee", items: rows as unknown[] });
    }

    if (types.includes("space")) {
      const spaceFilter = role === "employee"
        ? `AND EXISTS (SELECT 1 FROM space_members WHERE space_id = s.id AND employee_id = '${userId}'::uuid)`
        : "";

      const rows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT
          'space' AS type,
          s.id, s.name, s.color, s.icon
        FROM spaces s
        WHERE s.name ILIKE '%${escaped}%'
          ${spaceFilter}
        ORDER BY s.name ASC
        LIMIT ${limit}
      `));
      results.push({ type: "space", items: rows as unknown[] });
    }

    return results;
  },

  // ── Daily time aggregation (for timesheet) ──────────────────────────────────

  async getDailyTimeTotals(params: {
    start: string; // yyyy-MM-dd
    end:   string; // yyyy-MM-dd
    userId: string;
    role:   string;
  }) {
    const { start, end, userId, role } = params;

    // scope
    let scope = "";
    if (role === "manager") {
      scope = `AND (s.employee_id = '${userId}'::uuid OR s.employee_id IN (SELECT id FROM employees WHERE manager_id = '${userId}'::uuid))`;
    } else if (role !== "admin" && role !== "hr") {
      scope = `AND s.employee_id = '${userId}'::uuid`;
    }

    // รวม session ที่ปิดแล้ว + session ที่ยัง running อยู่ (คำนวณเวลา real-time)
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        s.employee_id                                        AS "employeeId",
        s.task_id                                            AS "taskId",
        to_char((s.started_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(
          CASE
            WHEN s.ended_at IS NOT NULL AND s.duration_min IS NOT NULL THEN s.duration_min
            WHEN s.ended_at IS NULL THEN
              GREATEST(0, EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 60)::int
            ELSE 0
          END
        ), 0)::int                                           AS "durationMin",
        t.title                                              AS "taskTitle",
        t.display_id                                         AS "taskDisplayId",
        t.status                                             AS status,
        ls.name                                              AS "statusName",
        ls.color                                             AS "statusColor"
      FROM task_time_sessions s
      JOIN tasks t         ON t.id = s.task_id
      LEFT JOIN list_statuses ls ON ls.id = t.list_status_id
      WHERE (s.started_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN '${start}' AND '${end}'
        ${scope}
      GROUP BY s.employee_id, s.task_id, day, t.title, t.display_id, t.status, ls.name, ls.color
      HAVING COALESCE(SUM(
        CASE
          WHEN s.ended_at IS NOT NULL AND s.duration_min IS NOT NULL THEN s.duration_min
          WHEN s.ended_at IS NULL THEN
            GREATEST(0, EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 60)::int
          ELSE 0
        END
      ), 0) > 0
      ORDER BY day ASC
    `));
    return rows as unknown as Array<Record<string, any>>;
  },

  // ── Rework ──────────────────────────────────────────────────────────────────

  async listReworkEvents(taskId: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        r.id,
        r.task_id          AS "taskId",
        r.from_status_id   AS "fromStatusId",
        r.to_status_id     AS "toStatusId",
        r.from_status_name AS "fromStatusName",
        r.to_status_name   AS "toStatusName",
        r.reason,
        r.requested_by     AS "requestedBy",
        r.created_at       AS "createdAt",
        e.name             AS "requestedByName",
        e.avatar_url       AS "requestedByAvatar"
      FROM task_rework_events r
      LEFT JOIN employees e ON e.id = r.requested_by
      WHERE r.task_id = '${taskId}'::uuid
      ORDER BY r.created_at DESC
    `));
    return rows as unknown as Array<Record<string, any>>;
  },

  async createReworkEvent(taskId: string, requestedBy: string, toStatusId: string, reason: string) {
    return await db.transaction(async (tx) => {
      // Fetch current task + status names for snapshot
      const current = await tx.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
      if (!current) throw new Error("Task not found");

      const fromStatus = current.listStatusId
        ? await tx.query.listStatuses.findFirst({ where: eq(listStatuses.id, current.listStatusId) })
        : null;
      const toStatus = await tx.query.listStatuses.findFirst({ where: eq(listStatuses.id, toStatusId) });
      if (!toStatus) throw new Error("Target status not found");

      // Insert event
      const [event] = await tx.insert(taskReworkEvents).values({
        taskId,
        fromStatusId:   current.listStatusId ?? null,
        toStatusId,
        fromStatusName: fromStatus?.name ?? null,
        toStatusName:   toStatus.name,
        reason,
        requestedBy,
      }).returning();

      // Update task: set new status + increment counter + timestamp
      await tx.update(tasks).set({
        listStatusId:    toStatusId,
        reworkCount:     (current.reworkCount ?? 0) + 1,
        lastReworkedAt:  new Date(),
        updatedAt:       new Date(),
      }).where(eq(tasks.id, taskId));

      return event;
    });
  },

  /**
   * Move a task to another list.
   * - Picks the new list's default status (is_default=true) or the first one by display_order.
   * - Resets list_status_id since statuses are list-scoped.
   * - Places the task at the end of the target list (display_order = max+1).
   */
  async moveTask(taskId: string, toListId: string) {
    return await db.transaction(async (tx) => {
      const current = await tx.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
      if (!current) throw new Error("Task not found");
      if (current.listId === toListId) return current;

      // Verify target list exists
      const targetList = await tx.query.lists.findFirst({ where: eq(lists.id, toListId) });
      if (!targetList) throw new Error("Target list not found");

      // Pick target status: default first, else lowest display_order
      const targetStatuses = await tx.query.listStatuses.findMany({
        where: eq(listStatuses.listId, toListId),
      });
      const defaultStatus =
        targetStatuses.find((s: any) => s.isDefault) ??
        [...targetStatuses].sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))[0] ??
        null;

      // New display_order = max in target + 1
      const maxRows = await tx.execute(
        sql.raw(`SELECT COALESCE(MAX(display_order), 0) AS m FROM tasks WHERE list_id = '${toListId}'::uuid AND deleted_at IS NULL`)
      );
      const nextOrder = Number((maxRows as any).rows?.[0]?.m ?? 0) + 1;

      const [updated] = await tx.update(tasks).set({
        listId:        toListId,
        listStatusId:  defaultStatus?.id ?? null,
        displayOrder:  nextOrder,
        updatedAt:     new Date(),
      }).where(eq(tasks.id, taskId)).returning();

      return updated;
    });
  },
};
