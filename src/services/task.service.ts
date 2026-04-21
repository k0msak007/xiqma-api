import { taskRepository } from "@/repositories/task.repository.ts";
import { listRepository } from "@/repositories/list.repository.ts";
import { spaceRepository } from "@/repositories/space.repository.ts";
import { employeeRepository } from "@/repositories/employee.repository.ts";
import { reportsRepository } from "@/repositories/performance.repository.ts";
import { supabase, ATTACHMENTS_BUCKET, getSignedAvatarUrl } from "@/lib/supabase.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";
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
    return taskRepository.create(data, creatorId);
  },

  async updateTask(id: string, data: UpdateTaskInput) {
    const task = await taskRepository.findById(id);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${id}`, 404);
    }
    return taskRepository.update(id, data);
  },

  async updateTaskStatus(id: string, data: UpdateTaskStatusInput) {
    const task = await taskRepository.findById(id);
    if (!task) {
      throw new AppError(ErrorCode.NOT_FOUND, `ไม่พบ task id: ${id}`, 404);
    }
    const updated = await taskRepository.updateStatus(id, {
      listStatusId: data.listStatusId,
      ...(data.status ? { status: data.status } : {}),
    });

    // เมื่อ task เสร็จ → อัปเดต weekly report ของ assignee ทันที (fire-and-forget)
    if (data.status === "completed") {
      const assigneeId = (task as Record<string, unknown>).assignee_id as string;
      void reportsRepository
        .generateWeeklyReport({ employee_id: assigneeId })
        .catch((e: unknown) => console.error("[points] generate weekly report failed:", e));
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
    return taskRepository.updateComment(commentId, data);
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

    return taskRepository.createExtensionRequest(taskId, requestedBy, data);
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
    return taskRepository.approveExtension(extensionId, reviewedBy);
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
    return taskRepository.rejectExtension(extensionId, reviewedBy, data.rejectReason);
  },

  async listAllExtensionRequests(status: string | undefined, userId: string, role: string) {
    return taskRepository.listExtensionRequests(status, userId, role);
  },

  // ── Search ────────────────────────────────────────────────────────────────────

  async search(q: string, types: string[], limit: number, userId: string, role: string) {
    return taskRepository.search(q, types, limit, userId, role);
  },
};
