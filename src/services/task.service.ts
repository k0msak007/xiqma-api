import { taskRepository } from "@/repositories/task.repository.ts";
import { listRepository } from "@/repositories/list.repository.ts";
import { spaceRepository } from "@/repositories/space.repository.ts";
import { employeeRepository } from "@/repositories/employee.repository.ts";
import { reportsRepository } from "@/repositories/performance.repository.ts";
import { supabase, ATTACHMENTS_BUCKET, getSignedAvatarUrl } from "@/lib/supabase.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { emitNotification } from "@/lib/notification/dispatcher.ts";
import { normalizeRecipients } from "@/lib/notification/events.ts";
import { embedText, createEmbedding, toVectorLiteral } from "@/lib/embedding.ts";
import { logger } from "@/lib/logger.ts";

// Returns the status_type for a list_status_id, or null.
async function getStatusType(listStatusId: string | null | undefined): Promise<string | null> {
  if (!listStatusId) return null;
  try {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT type::text AS type FROM list_statuses WHERE id = '${listStatusId}'::uuid LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r?.type ? String(r.type) : null;
  } catch {
    return null;
  }
}

const TERMINAL_STATUS_TYPES = new Set(["done", "completed", "closed", "cancelled"]);

// Audit-style audience for task events:
//   = baseRecipients ∪ assignee ∪ assignee.manager ∪ all admins  (minus actor)
//
// Use this for any task-related event so:
//   • assignee always sees what happens on their tasks
//   • assignee's manager (line supervisor) is in the loop
//   • all admins observe org-wide activity
async function augmentTaskAudience(
  taskId: string,
  baseRecipients: (string | null | undefined)[],
  actorId?: string,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const r of baseRecipients) if (r) ids.add(r);

  // Assignee + their direct manager
  try {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.assignee_id::text  AS assignee_id,
        e.manager_id::text   AS manager_id
      FROM tasks t
      LEFT JOIN employees e ON e.id = t.assignee_id
      WHERE t.id = '${taskId}'::uuid
      LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    if (r) {
      if (r.assignee_id) ids.add(String(r.assignee_id));
      if (r.manager_id)  ids.add(String(r.manager_id));
    }
  } catch (err) {
    console.error("[augmentTaskAudience.task]", err);
  }

  // All active admins
  try {
    const adminRows = await db.execute<{ id: string }>(sql.raw(`
      SELECT e.id::text AS id FROM employees e
      LEFT JOIN roles r ON e.role_id = r.id
      WHERE e.is_active = true AND r.name = 'admin'
    `));
    const arr = (((adminRows as any).rows ?? adminRows) as Array<{ id: string }>);
    for (const a of arr) ids.add(String(a.id));
  } catch (err) {
    console.error("[augmentTaskAudience.admins]", err);
  }

  if (actorId) ids.delete(actorId);
  return Array.from(ids);
}

// Find admins + the task creator (if provided) for review-style notifications.
async function findApproverIds(creatorId: string | undefined): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql.raw(`
    SELECT e.id::text FROM employees e
    LEFT JOIN roles r ON e.role_id = r.id
    WHERE e.is_active = true
      AND (r.name = 'admin' OR r.name = 'manager')
  `));
  const arr = ((rows as any).rows ?? rows) as Array<{ id: string }>;
  const ids = arr.map((r) => String(r.id));
  if (creatorId && !ids.includes(creatorId)) ids.push(creatorId);
  return ids;
}

// Resolve "@token" mention strings → employee ids (fuzzy: exact name first, then code, then substring).
async function resolveMentionedEmployees(tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) return [];
  const out = new Set<string>();
  // Load active employees once
  const rows = await db.execute<{ id: string; name: string; code: string | null }>(sql.raw(`
    SELECT id::text, name, employee_code AS code FROM employees WHERE is_active = true
  `));
  const employees = ((rows as any).rows ?? rows) as Array<{ id: string; name: string; code: string | null }>;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

  for (const raw of tokens) {
    const t = norm(raw);
    if (!t) continue;
    // Exact name
    let hit = employees.find((e) => norm(e.name) === t);
    // Exact code
    if (!hit) hit = employees.find((e) => e.code && norm(e.code) === t);
    // Substring on first name
    if (!hit) {
      hit = employees.find((e) => {
        const first = e.name.split(/\s+/)[0];
        return first ? norm(first) === t || norm(e.name).includes(t) : false;
      });
    }
    if (hit) out.add(hit.id);
  }
  return Array.from(out);
}
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
  RejectExtensionInput,
} from "@/validators/task.validator.ts";

// ── Embedding fire-and-forget helper ───────────────────────────────────────
async function embedTaskAsync(taskId: string, title: string, description?: string | null) {
  try {
    const text = embedText({ title, description });
    if (!text) return;
    const embedding = await createEmbedding(text);
    const vec = toVectorLiteral(embedding);
    await db.execute(sql.raw(`
      INSERT INTO task_embeddings (task_id, embedding, updated_at)
      VALUES ('${taskId}'::uuid, ${vec}, NOW())
      ON CONFLICT (task_id) DO UPDATE SET embedding = ${vec}, updated_at = NOW()
    `));
    logger.info({ taskId }, "embedding stored");
  } catch (err) {
    logger.warn({ err, taskId }, "embedding generation failed (non-fatal)");
    void err;
  }
}

export const taskService = {
  // ── Tasks ─────────────────────────────────────────────────────────────────────

  async listTasks(
    params: {
      listId: string;
      statusId?: string | undefined;
      assigneeId?: string | undefined;
      priority?: string | undefined;
      search?: string | undefined;
      page: number;
      limit: number;
      sort: string;
    },
    userId: string,
    role: string,
  ) {
    // Check list exists
    const list = await listRepository.findById(params.listId);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${params.listId}`, 404);
    }
    // Check space membership for non-admin/manager
    if (role === "employee") {
      const isMember = await spaceRepository.isMember(list.spaceId, userId);
      if (!isMember) {
        throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่ได้เป็นสมาชิกของ space นี้", 403);
      }
    }
    return taskRepository.findAll(params);
  },

  async myTasks(userId: string, range?: string) {
    return taskRepository.findMy(userId, range);
  },

  async calendarTasks(userId: string, role: string, start: string, end: string) {
    if (start > end) {
      throw new AppError(ErrorCode.INVALID_DATE_RANGE, "start ต้องไม่มากกว่า end", 400);
    }
    return taskRepository.findCalendar(userId, role, start, end);
  },

  async getTask(id: string, userId: string, role: string) {
    const task = await taskRepository.findById(id);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${id}`, 404);
    }
    return task;
  },

  async createTask(data: CreateTaskInput, creatorId: string, role: string) {
    // Check list exists
    const list = await listRepository.findById(data.listId);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${data.listId}`, 404);
    }
    // Check assignee exists
    const assignee = await employeeRepository.findById(data.assigneeId);
    if (!assignee) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ employee id: ${data.assigneeId}`, 404);
    }
    const task = await taskRepository.create(data, creatorId);

    // 🔌 Embed task for semantic search (fire-and-forget — failure is non-fatal)
    embedTaskAsync((task as any).id as string, data.title, data.description).catch(() => {});

    // 🔔 Notify assignee + their manager + all admins (skip actor)
    const taskId = (task as any).id as string;
    const displayId = (task as any).display_id as string | undefined;
    const recipients = await augmentTaskAudience(taskId, [data.assigneeId], creatorId);
    emitNotification({
      type:        "assigned",
      recipients,
      actorId:     creatorId,
      title:       `มีงานใหม่: ${data.title}`,
      body:        displayId ? `[${displayId}] ${data.title}` : data.title,
      relatedType: "task",
      relatedId:   taskId,
      taskId,
      deepLink:    `/task/${taskId}`,
    });

    return task;
  },

  async updateTask(id: string, data: UpdateTaskInput) {
    const task = await taskRepository.findById(id);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${id}`, 404);
    }

    // Detect status terminal-transition before mutating
    const oldStatusId = (task as any).list_status_id as string | undefined;
    const newStatusId = data.listStatusId ?? undefined;
    const statusChanged = !!newStatusId && newStatusId !== oldStatusId;
    const [oldType, newType] = statusChanged
      ? await Promise.all([getStatusType(oldStatusId), getStatusType(newStatusId)])
      : [null, null];
    const enteringTerminal =
      !!newType && TERMINAL_STATUS_TYPES.has(newType) &&
      (!oldType || !TERMINAL_STATUS_TYPES.has(oldType));

    const updated = await taskRepository.update(id, data);

    // 🔌 Re-embed if title or description changed (fire-and-forget)
    if (data.title !== undefined || data.description !== undefined) {
      const freshTitle = (updated as any)?.title ?? (task as any)?.title ?? "";
      const freshDesc  = (updated as any)?.description ?? (task as any)?.description ?? null;
      embedTaskAsync(id, freshTitle, freshDesc).catch(() => {});
    }

    // 🔔 If assignee changed → notify new assignee + their manager + admins
    const oldAssignee = (task as any).assignee_id as string | undefined;
    const newAssignee = data.assigneeId;
    if (newAssignee && newAssignee !== oldAssignee) {
      const title = (updated as any)?.title ?? (task as any)?.title ?? "งาน";
      const displayId = (updated as any)?.display_id ?? (task as any)?.display_id;
      const recipients = await augmentTaskAudience(id, [newAssignee]);
      emitNotification({
        type:        "assigned",
        recipients,
        title:       `มีงานใหม่: ${title}`,
        body:        displayId ? `[${displayId}] ${title}` : title,
        relatedType: "task",
        relatedId:   id,
        taskId:      id,
        deepLink:    `/task/${id}`,
      });
    }

    // 🔔 If status entered terminal (done/completed/closed/cancelled) → notify creator + assignee + manager + admins
    if (enteringTerminal) {
      const assigneeId = (task as any).assignee_id as string | undefined;
      const creatorId  = (task as any).creator_id as string | undefined;
      const title      = (updated as any)?.title ?? (task as any)?.title ?? "งาน";
      const displayId  = (updated as any)?.display_id ?? (task as any)?.display_id;
      const recipients = await augmentTaskAudience(id, [creatorId, assigneeId]);
      emitNotification({
        type:        "task_completed",
        recipients,
        title:       `งานเสร็จ: ${title}`,
        body:        displayId ? `[${displayId}] ${title}` : title,
        relatedType: "task",
        relatedId:   id,
        taskId:      id,
        deepLink:    `/task/${id}`,
      });
      // Also refresh weekly report
      if (assigneeId) {
        void reportsRepository
          .generateWeeklyReport({ employee_id: assigneeId })
          .catch((e: unknown) => console.error("[points] generate weekly report failed:", e));
      }
    }

    return updated;
  },

  async updateTaskStatus(id: string, data: UpdateTaskStatusInput) {
    const task = await taskRepository.findById(id);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${id}`, 404);
    }

    // Detect transition into terminal state (done/completed/closed/cancelled).
    // We compare new status type vs old — only emit if entering terminal from non-terminal.
    const oldStatusId = (task as any).list_status_id as string | undefined;
    const [oldType, newType] = await Promise.all([
      getStatusType(oldStatusId),
      getStatusType(data.listStatusId),
    ]);
    const enteringTerminal =
      !!newType && TERMINAL_STATUS_TYPES.has(newType) &&
      (!oldType || !TERMINAL_STATUS_TYPES.has(oldType));

    const updated = await taskRepository.updateStatus(id, {
      listStatusId: data.listStatusId,
      ...(data.status ? { status: data.status } : {}),
    });

    if (enteringTerminal) {
      const assigneeId = (task as any).assignee_id as string | undefined;

      // Update weekly report (fire-and-forget)
      if (assigneeId) {
        void reportsRepository
          .generateWeeklyReport({ employee_id: assigneeId })
          .catch((e: unknown) => console.error("[points] generate weekly report failed:", e));
      }

      // 🔔 Notify creator + assignee + assignee's manager + admins
      const creatorId  = (task as any).creator_id as string | undefined;
      const title      = (task as any).title as string;
      const displayId  = (task as any).display_id as string | undefined;
      const recipients = await augmentTaskAudience(id, [creatorId, assigneeId]);
      emitNotification({
        type:        "task_completed",
        recipients,
        title:       `งานเสร็จ: ${title}`,
        body:        displayId ? `[${displayId}] ${title}` : title,
        relatedType: "task",
        relatedId:   id,
        taskId:      id,
        deepLink:    `/task/${id}`,
      });
    }

    return updated;
  },

  async reorderTasks(data: ReorderTasksInput) {
    const list = await listRepository.findById(data.listId);
    if (!list) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ list id: ${data.listId}`, 404);
    }
    // Validate all task IDs belong to this list + status
    const existingIds = await taskRepository.findTasksByListAndStatus(data.listId, data.statusId);
    const existingSet = new Set(existingIds);
    for (const tid of data.orderedTaskIds) {
      if (!existingSet.has(tid)) {
        throw new AppError(ErrorCode.NOT_FOUND, `task id: ${tid} ไม่อยู่ใน list/status นี้`, 404);
      }
    }
    await taskRepository.reorder(data.listId, data.statusId, data.orderedTaskIds);
  },

  async deleteTask(id: string) {
    const task = await taskRepository.findById(id);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${id}`, 404);
    }
    await taskRepository.softDelete(id);
  },

  // ── Subtasks ──────────────────────────────────────────────────────────────────

  async listSubtasks(taskId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    return taskRepository.findSubtasks(taskId);
  },

  async createSubtask(taskId: string, userId: string, data: CreateSubtaskInput) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    return taskRepository.createSubtask(taskId, data, userId);
  },

  async updateSubtask(taskId: string, subtaskId: string, userId: string, data: UpdateSubtaskInput) {
    const subtask = await taskRepository.findSubtaskById(subtaskId);
    if (!subtask || subtask.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ subtask id: ${subtaskId} ใน task นี้`, 404);
    }
    return taskRepository.updateSubtask(subtaskId, data, userId);
  },

  async toggleSubtask(taskId: string, subtaskId: string, userId: string) {
    const subtask = await taskRepository.findSubtaskById(subtaskId);
    if (!subtask || subtask.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ subtask id: ${subtaskId} ใน task นี้`, 404);
    }
    return taskRepository.toggleSubtask(subtaskId, userId);
  },

  async deleteSubtask(taskId: string, subtaskId: string) {
    const subtask = await taskRepository.findSubtaskById(subtaskId);
    if (!subtask || subtask.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ subtask id: ${subtaskId} ใน task นี้`, 404);
    }
    await taskRepository.deleteSubtask(subtaskId);
  },

  async reorderSubtasks(taskId: string, orderedIds: string[]) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    await taskRepository.reorderSubtasks(taskId, orderedIds);
    return taskRepository.findSubtasks(taskId);
  },

  // ── Comments ──────────────────────────────────────────────────────────────────

  async listComments(taskId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    const comments = await taskRepository.findComments(taskId);
    
    // Generate signed URLs for avatars
    const commentsWithSignedAvatars = await Promise.all(
      comments.map(async (comment) => ({
        ...comment,
        authorAvatar: comment.authorAvatar 
          ? await getSignedAvatarUrl(comment.authorAvatar)
          : null,
      }))
    );
    
    return commentsWithSignedAvatars;
  },

  async createComment(taskId: string, authorId: string, data: CreateCommentInput) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    const comment = await taskRepository.createComment(taskId, authorId, data);

    // 🔔 @mentions: parse @<name> and resolve to employee ids
    const text = data.commentText ?? "";
    const mentionTokens = Array.from(text.matchAll(/@([^\s,@]{2,40})/g)).map((m) => m[1] ?? "");
    let mentionedIds: string[] = [];
    if (mentionTokens.length > 0) {
      try {
        mentionedIds = await resolveMentionedEmployees(mentionTokens);
        const taskTitle = (task as any).title as string;
        const displayId = (task as any).display_id as string | undefined;
        // Augment: mentioned + assignee + assignee's manager + admins
        const recipients = await augmentTaskAudience(taskId, mentionedIds, authorId);
        emitNotification({
          type:        "comment_mention",
          recipients,
          actorId:     authorId,
          title:       displayId ? `มี @ คุณใน [${displayId}]` : `มี @ คุณใน "${taskTitle}"`,
          body:        text.length > 200 ? text.slice(0, 200) + "..." : text,
          relatedType: "comment",
          relatedId:   (comment as any).id ?? null,
          taskId,
          deepLink:    `/task/${taskId}`,
        });
      } catch (err) {
        // Mentions are best-effort; don't fail comment creation
        console.error("[notify.comment_mention] resolve failed:", err);
      }
    }

    // 🔔 comment_reply: notify earlier commenters + assignee + manager + admins
    // (skip recipients already covered by comment_mention to avoid double-noti)
    try {
      const priorRows = await db.execute<{ author_id: string }>(sql.raw(`
        SELECT DISTINCT author_id::text AS author_id FROM task_comments
        WHERE task_id = '${taskId}'::uuid AND author_id IS NOT NULL
      `));
      const priorIds = (((priorRows as any).rows ?? priorRows) as Array<{ author_id: string }>)
        .map((r) => String(r.author_id));

      const augmented = await augmentTaskAudience(taskId, priorIds, authorId);
      // Skip people who already got comment_mention noti (would be redundant)
      const recipients = augmented.filter((id) => !mentionedIds.includes(id));

      if (recipients.length > 0) {
        const taskTitle = (task as any).title as string;
        const displayId = (task as any).display_id as string | undefined;
        emitNotification({
          type:        "comment_reply",
          recipients,
          actorId:     authorId,
          title:       displayId ? `Comment ใหม่ใน [${displayId}]` : `Comment ใหม่ใน "${taskTitle}"`,
          body:        text.length > 200 ? text.slice(0, 200) + "..." : text,
          relatedType: "comment",
          relatedId:   (comment as any).id ?? null,
          taskId,
          deepLink:    `/task/${taskId}`,
        });
      }
    } catch (err) {
      console.error("[notify.comment_reply] failed:", err);
    }

    // Generate signed URL for avatar
    return {
      ...comment,
      authorAvatar: comment.authorAvatar
        ? await getSignedAvatarUrl(comment.authorAvatar)
        : null,
    };
  },

  async updateComment(taskId: string, commentId: string, userId: string, data: UpdateCommentInput) {
    const comment = await taskRepository.findCommentById(commentId);
    if (!comment || comment.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ comment id: ${commentId} ใน task นี้`, 404);
    }
    if (comment.authorId !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่มีสิทธิ์แก้ไข comment นี้", 403);
    }
    const updated = await taskRepository.updateComment(commentId, data);
    return {
      ...updated,
      authorAvatar: updated.authorAvatar
        ? await getSignedAvatarUrl(updated.authorAvatar)
        : null,
    };
  },

  async deleteComment(taskId: string, commentId: string, userId: string, role: string) {
    const comment = await taskRepository.findCommentById(commentId);
    if (!comment || comment.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ comment id: ${commentId} ใน task นี้`, 404);
    }
    if (comment.authorId !== userId && role !== "admin") {
      throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่มีสิทธิ์ลบ comment นี้", 403);
    }
    await taskRepository.deleteComment(commentId);
  },

  // ── Time Tracking ─────────────────────────────────────────────────────────────

  async startTime(taskId: string, employeeId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    // Check for any running session for this employee
    const running = await taskRepository.findRunningSession(employeeId);
    if (running) {
      throw new AppError(
        ErrorCode.SESSION_ALREADY_RUNNING,
        `มี session ที่กำลังทำงานอยู่ (task id: ${running.taskId})`,
        409,
        { runningTaskId: running.taskId, sessionId: running.id }
      );
    }
    return taskRepository.startSession(taskId, employeeId);
  },

  async pauseTime(taskId: string, employeeId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    const durationMin = await taskRepository.closeRunningSession(taskId, employeeId);
    return { durationMin };
  },

  async completeTime(taskId: string, employeeId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    // Close any running session
    await taskRepository.closeRunningSession(taskId, employeeId);
    // Mark task as completed
    const updated = await taskRepository.updateStatus(taskId, {
      listStatusId:
        (task as Record<string, unknown>).list_status_id as string ??
        (task as Record<string, unknown>).listStatusId as string,
      status: "completed",
    });

    // อัปเดต weekly report ของ assignee ทันที (fire-and-forget)
    const assigneeId = (task as Record<string, unknown>).assignee_id as string;
    void reportsRepository
      .generateWeeklyReport({ employee_id: assigneeId })
      .catch((e: unknown) => console.error("[points] generate weekly report failed:", e));

    return updated;
  },

  async getTimeSessions(taskId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    return taskRepository.findTimeSessions(taskId);
  },

  async getRunningSessions(employeeId: string) {
    return taskRepository.findRunningSession(employeeId);
  },

  async logTimeManual(taskId: string, employeeId: string, data: { durationMin: number; note?: string; startedAt?: string }) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    return taskRepository.logTimeManual(
      taskId,
      employeeId,
      data.durationMin,
      data.note,
      data.startedAt ? new Date(data.startedAt) : undefined,
    );
  },

  async deleteTimeSession(taskId: string, sessionId: string, userId: string, role: string) {
    const session = await taskRepository.findTimeSessionById(sessionId);
    if (!session || session.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ time session id: ${sessionId}`, 404);
    }
    if (session.employeeId !== userId && role !== "admin") {
      throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่มีสิทธิ์ลบ session นี้", 403);
    }
    await taskRepository.deleteTimeSession(sessionId);
  },

  // ── Attachments ───────────────────────────────────────────────────────────────

  async listAttachments(taskId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    return taskRepository.findAttachments(taskId);
  },

  async uploadAttachment(
    taskId: string,
    uploadedBy: string,
    file: { buffer: Uint8Array; name: string; mimeType: string; size: number }
  ) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }

    const ext       = file.name.split(".").pop() ?? "bin";
    const timestamp = Date.now();
    const path      = `tasks/${taskId}/${timestamp}-${file.name}`;

    const { data: uploadData, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimeType, upsert: false });

    if (error || !uploadData) {
      throw new AppError(ErrorCode.UPLOAD_FAILED, `อัปโหลดไฟล์ล้มเหลว: ${error?.message ?? "unknown"}`, 500);
    }

    const { data: urlData } = supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .getPublicUrl(path);

    return taskRepository.createAttachment(taskId, uploadedBy, {
      fileUrl:       urlData.publicUrl,
      fileName:      file.name,
      fileSizeBytes: file.size,
      mimeType:      file.mimeType,
    });
  },

  async deleteAttachment(taskId: string, attachmentId: string, userId: string, role: string) {
    const attachment = await taskRepository.findAttachmentById(attachmentId);
    if (!attachment || attachment.taskId !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ attachment id: ${attachmentId} ใน task นี้`, 404);
    }
    if (attachment.uploadedBy !== userId && role !== "admin" && role !== "manager") {
      throw new AppError(ErrorCode.FORBIDDEN, "คุณไม่มีสิทธิ์ลบไฟล์นี้", 403);
    }

    // Delete from Supabase Storage
    if (attachment.fileUrl) {
      try {
        const url  = new URL(attachment.fileUrl);
        const pathParts = url.pathname.split(`/${ATTACHMENTS_BUCKET}/`);
        if (pathParts.length > 1 && pathParts[1]) {
          await supabase.storage.from(ATTACHMENTS_BUCKET).remove([pathParts[1]]);
        }
      } catch {
        // Non-fatal: continue deleting DB record even if storage delete fails
      }
    }

    await taskRepository.deleteAttachment(attachmentId);
  },

  // ── Extension Requests ────────────────────────────────────────────────────────

  async listExtensionRequests(taskId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }
    return taskRepository.findExtensionRequests(taskId);
  },

  async createExtensionRequest(taskId: string, requestedBy: string, data: CreateExtensionInput) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    }

    // Check no pending request already
    const existing = await taskRepository.findPendingExtensionForTask(taskId);
    if (existing) {
      throw new AppError(ErrorCode.PENDING_REQUEST_EXISTS, "มีคำขอขยายเวลาที่รอการอนุมัติอยู่แล้ว", 409);
    }

    // Check new deadline > current deadline
    const taskRecord = task as Record<string, unknown>;
    const currentDeadline = taskRecord.deadline as string | null;
    if (currentDeadline && new Date(data.newDeadline) <= new Date(currentDeadline)) {
      throw new AppError(ErrorCode.INVALID_DATE_RANGE, "deadline ใหม่ต้องมากกว่า deadline ปัจจุบัน", 400);
    }

    const ext = await taskRepository.createExtensionRequest(taskId, requestedBy, data);

    // 🔔 Notify reviewers + assignee's manager + admins (de-duped)
    try {
      const reviewers = await findApproverIds(taskRecord.creator_id as string | undefined);
      const title = (taskRecord.title as string) ?? "งาน";
      const displayId = taskRecord.display_id as string | undefined;
      const recipients = await augmentTaskAudience(taskId, reviewers, requestedBy);
      emitNotification({
        type:        "extension_request",
        recipients,
        actorId:     requestedBy,
        title:       displayId ? `ขอขยายเวลา [${displayId}]` : `ขอขยายเวลา: ${title}`,
        body:        data.reason ?? title,
        relatedType: "extension",
        relatedId:   (ext as any)?.id ?? null,
        taskId,
        deepLink:    `/task/${taskId}`,
      });
    } catch (err) { console.error("[notify.extension_request]", err); }

    return ext;
  },

  async approveExtension(extensionId: string, reviewedBy: string, role: string) {
    if (role !== "manager" && role !== "admin") {
      throw new AppError(ErrorCode.FORBIDDEN, "ต้องเป็น manager หรือ admin เท่านั้น", 403);
    }
    const ext = await taskRepository.findExtensionById(extensionId);
    if (!ext) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ extension request id: ${extensionId}`, 404);
    }
    const extRecord = ext as Record<string, unknown>;
    if (extRecord.status !== "pending") {
      throw new AppError(ErrorCode.FORBIDDEN, "คำขอนี้ได้รับการพิจารณาแล้ว", 409);
    }
    const updated = await taskRepository.approveExtension(extensionId, reviewedBy);

    // 🔔 Notify requester + assignee + manager + admins
    try {
      const requesterId = extRecord.requested_by as string | undefined;
      const taskId      = extRecord.task_id as string | undefined;
      if (taskId) {
        const recipients = await augmentTaskAudience(taskId, [requesterId], reviewedBy);
        if (recipients.length > 0) {
          emitNotification({
            type:        "extension_approved",
            recipients,
            actorId:     reviewedBy,
            title:       "คำขอขยายเวลาได้รับการอนุมัติ",
            body:        "deadline ใหม่มีผลแล้ว",
            relatedType: "extension",
            relatedId:   extensionId,
            taskId,
            deepLink:    `/task/${taskId}`,
          });
        }
      }
    } catch (err) { console.error("[notify.extension_approved]", err); }

    return updated;
  },

  async rejectExtension(extensionId: string, reviewedBy: string, role: string, data: RejectExtensionInput) {
    if (role !== "manager" && role !== "admin") {
      throw new AppError(ErrorCode.FORBIDDEN, "ต้องเป็น manager หรือ admin เท่านั้น", 403);
    }
    const ext = await taskRepository.findExtensionById(extensionId);
    if (!ext) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ extension request id: ${extensionId}`, 404);
    }
    const extRecord = ext as Record<string, unknown>;
    if (extRecord.status !== "pending") {
      throw new AppError(ErrorCode.FORBIDDEN, "คำขอนี้ได้รับการพิจารณาแล้ว", 409);
    }
    const updated = await taskRepository.rejectExtension(extensionId, reviewedBy, data.rejectReason);

    // 🔔 Notify requester + assignee + manager + admins (with reason)
    try {
      const requesterId = extRecord.requested_by as string | undefined;
      const taskId      = extRecord.task_id as string | undefined;
      if (taskId) {
        const recipients = await augmentTaskAudience(taskId, [requesterId], reviewedBy);
        if (recipients.length > 0) {
          emitNotification({
            type:        "extension_rejected",
            recipients,
            actorId:     reviewedBy,
            title:       "คำขอขยายเวลาถูกปฏิเสธ",
            body:        data.rejectReason,
            relatedType: "extension",
            relatedId:   extensionId,
            taskId,
            deepLink:    `/task/${taskId}`,
          });
        }
      }
    } catch (err) { console.error("[notify.extension_rejected]", err); }

    return updated;
  },

  async listAllExtensionRequests(status: string | undefined, userId: string, role: string) {
    return taskRepository.listExtensionRequests(status, userId, role);
  },

  // ── Search ────────────────────────────────────────────────────────────────────

  async search(q: string, types: string[], limit: number, userId: string, role: string) {
    return taskRepository.search(q, types, limit, userId, role);
  },

  // ── Daily time (timesheet) ────────────────────────────────────────────────────

  async getDailyTime(start: string, end: string, userId: string, role: string) {
    return taskRepository.getDailyTimeTotals({ start, end, userId, role });
  },

  // ── Rework ────────────────────────────────────────────────────────────────────

  async listReworkEvents(taskId: string) {
    return taskRepository.listReworkEvents(taskId);
  },

  async createReworkEvent(taskId: string, userId: string, data: { toStatusId: string; reason: string }) {
    const task = await taskRepository.findById(taskId);
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    const ev = await taskRepository.createReworkEvent(taskId, userId, data.toStatusId, data.reason);

    // 🔔 Notify assignee + their manager + admins (skip the actor who triggered)
    try {
      const tr = task as Record<string, unknown>;
      const title      = tr.title as string;
      const displayId  = tr.display_id as string | undefined;
      const recipients = await augmentTaskAudience(taskId, [], userId);
      if (recipients.length > 0) {
        emitNotification({
          type:        "rework_requested",
          recipients,
          actorId:     userId,
          title:       displayId ? `ส่งกลับแก้ไข [${displayId}]` : `ส่งกลับแก้ไข: ${title}`,
          body:        data.reason,
          relatedType: "task",
          relatedId:   taskId,
          taskId,
          deepLink:    `/task/${taskId}`,
        });
      }
    } catch (err) { console.error("[notify.rework_requested]", err); }

    return ev;
  },

  // ── Move (admin/manager only — permission enforced in route) ──────────────────
  async moveTask(taskId: string, toListId: string) {
    const task = await taskRepository.findById(taskId);
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${taskId}`, 404);
    return taskRepository.moveTask(taskId, toListId);
  },

  async bulkUpdate(taskIds: string[], updates: Record<string, any>) {
    let updated = 0;
    for (const id of taskIds) {
      try {
        await taskRepository.update(id, updates);
        updated++;
      } catch (err) {
        logger.warn({ err, taskId: id }, "bulkUpdate skip");
      }
    }
    return { total: taskIds.length, updated, failed: taskIds.length - updated };
  },
};
