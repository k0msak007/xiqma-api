import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { taskService } from "@/services/task.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  taskQuerySchema,
  myTasksQuerySchema,
  calendarQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  reorderTasksSchema,
  createSubtaskSchema,
  updateSubtaskSchema,
  reorderSubtasksSchema,
  createCommentSchema,
  updateCommentSchema,
  createExtensionRequestSchema,
  logTimeSchema,
  createReworkSchema,
  moveTaskSchema,
} from "@/validators/task.validator.ts";

const timeSessionParamSchema = z.object({ id: z.string().uuid(), sessionId: z.string().uuid() });

const idParamSchema         = z.object({ id: z.string().uuid() });
const subtaskParamSchema    = z.object({ id: z.string().uuid(), subtaskId: z.string().uuid() });
const commentParamSchema    = z.object({ id: z.string().uuid(), commentId: z.string().uuid() });
const attachmentParamSchema = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() });

export const tasksRouter = new Hono()
  .use(authMiddleware)

  // ── Static-path routes must come BEFORE /:id ─────────────────────────────────

  // GET /tasks/my
  .get("/my", validate("query", myTasksQuerySchema), async (c) => {
    const { range } = c.req.valid("query");
    const user      = c.get("user");
    const tasks     = await taskService.myTasks(user.userId, range);
    return ok(c, tasks, "ดึงข้อมูล task ของคุณสำเร็จ");
  })

  // GET /tasks/calendar
  .get("/calendar", validate("query", calendarQuerySchema), async (c) => {
    const { start, end } = c.req.valid("query");
    const user           = c.get("user");
    const tasks          = await taskService.calendarTasks(user.userId, user.role, start, end);
    return ok(c, tasks, "ดึงข้อมูล calendar สำเร็จ");
  })

  // PUT /tasks/reorder
  .put("/reorder", validate("json", reorderTasksSchema), async (c) => {
    const data = c.req.valid("json");
    const user = c.get("user");
    await taskService.reorderTasks(data);
    return ok(c, null, "เรียงลำดับ task สำเร็จ");
  })

  // ── Task CRUD ─────────────────────────────────────────────────────────────────

  // GET /tasks?listId=&statusId=&assigneeId=&priority=&search=&page=&limit=&sort=
  .get("/", validate("query", taskQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const user  = c.get("user");
    const result = await taskService.listTasks(
      {
        listId:     query.listId,
        statusId:   query.statusId ?? undefined,
        assigneeId: query.assigneeId ?? undefined,
        priority:   query.priority ? String(query.priority) : undefined,
        search:     query.search ?? undefined,
        page:       query.page ?? 1,
        limit:      query.limit ?? 20,
        sort:       String(query.sort ?? "display_order"),
      },
      user.userId,
      user.role,
    );
    const page  = query.page ?? 1;
    const limit = query.limit ?? 20;
    return ok(c, { data: result.data, total: result.total }, "ดึงข้อมูล task สำเร็จ", {
      page,
      limit,
      total:      result.total,
      totalPages: Math.ceil(result.total / limit),
    });
  })

  // POST /tasks
  .post("/", validate("json", createTaskSchema), async (c) => {
    const data = c.req.valid("json");
    const user = c.get("user");
    const task = await taskService.createTask(data, user.userId, user.role);
    return created(c, task, "สร้าง task สำเร็จ");
  })

  // GET /tasks/:id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const user   = c.get("user");
    const task   = await taskService.getTask(id, user.userId, user.role);
    return ok(c, task, "ดึงข้อมูล task สำเร็จ");
  })

  // PUT /tasks/:id
  .put("/:id", validate("param", idParamSchema), validate("json", updateTaskSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data   = c.req.valid("json");
    const task   = await taskService.updateTask(id, data);
    return ok(c, task, "แก้ไข task สำเร็จ");
  })

  // PATCH /tasks/:id/status
  .patch("/:id/status", validate("param", idParamSchema), validate("json", updateTaskStatusSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data   = c.req.valid("json");
    const task   = await taskService.updateTaskStatus(id, data);
    return ok(c, task, "อัปเดต status สำเร็จ");
  })

  // DELETE /tasks/:id
  .delete("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    await taskService.deleteTask(id);
    return ok(c, null, "ลบ task สำเร็จ");
  })

  // ── Subtasks ──────────────────────────────────────────────────────────────────

  // GET /tasks/:id/subtasks
  .get("/:id/subtasks", validate("param", idParamSchema), async (c) => {
    const { id }    = c.req.valid("param");
    const subtasks  = await taskService.listSubtasks(id);
    return ok(c, subtasks, "ดึงข้อมูล subtask สำเร็จ");
  })

  // POST /tasks/:id/subtasks
  .post("/:id/subtasks", validate("param", idParamSchema), validate("json", createSubtaskSchema), async (c) => {
    const { id }   = c.req.valid("param");
    const data     = c.req.valid("json");
    const user     = c.get("user");
    const subtask  = await taskService.createSubtask(id, user.userId, data);
    return created(c, subtask, "สร้าง subtask สำเร็จ");
  })

  // PUT /tasks/:id/subtasks/:subtaskId
  .put("/:id/subtasks/:subtaskId", validate("param", subtaskParamSchema), validate("json", updateSubtaskSchema), async (c) => {
    const { id, subtaskId } = c.req.valid("param");
    const data              = c.req.valid("json");
    const user              = c.get("user");
    const subtask           = await taskService.updateSubtask(id, subtaskId, user.userId, data);
    return ok(c, subtask, "แก้ไข subtask สำเร็จ");
  })

  // PATCH /tasks/:id/subtasks/:subtaskId/toggle
  .patch("/:id/subtasks/:subtaskId/toggle", validate("param", subtaskParamSchema), async (c) => {
    const { id, subtaskId } = c.req.valid("param");
    const user              = c.get("user");
    const subtask           = await taskService.toggleSubtask(id, subtaskId, user.userId);
    return ok(c, subtask, "toggle subtask สำเร็จ");
  })

  // DELETE /tasks/:id/subtasks/:subtaskId
  .delete("/:id/subtasks/:subtaskId", validate("param", subtaskParamSchema), async (c) => {
    const { id, subtaskId } = c.req.valid("param");
    await taskService.deleteSubtask(id, subtaskId);
    return ok(c, null, "ลบ subtask สำเร็จ");
  })

  // PATCH /tasks/:id/subtasks/reorder
  .patch("/:id/subtasks/reorder", validate("param", idParamSchema), validate("json", reorderSubtasksSchema), async (c) => {
    const { id }       = c.req.valid("param");
    const { orderedIds } = c.req.valid("json");
    const result       = await taskService.reorderSubtasks(id, orderedIds);
    return ok(c, result, "จัดลำดับ subtask สำเร็จ");
  })

  // ── Comments ──────────────────────────────────────────────────────────────────

  // GET /tasks/:id/comments
  .get("/:id/comments", validate("param", idParamSchema), async (c) => {
    const { id }    = c.req.valid("param");
    const comments  = await taskService.listComments(id);
    return ok(c, comments, "ดึงข้อมูล comment สำเร็จ");
  })

  // POST /tasks/:id/comments
  .post("/:id/comments", validate("param", idParamSchema), validate("json", createCommentSchema), async (c) => {
    const { id }   = c.req.valid("param");
    const data     = c.req.valid("json");
    const user     = c.get("user");
    const comment  = await taskService.createComment(id, user.userId, data);
    return created(c, comment, "สร้าง comment สำเร็จ");
  })

  // PUT /tasks/:id/comments/:commentId
  .put("/:id/comments/:commentId", validate("param", commentParamSchema), validate("json", updateCommentSchema), async (c) => {
    const { id, commentId } = c.req.valid("param");
    const data              = c.req.valid("json");
    const user              = c.get("user");
    const comment           = await taskService.updateComment(id, commentId, user.userId, data);
    return ok(c, comment, "แก้ไข comment สำเร็จ");
  })

  // DELETE /tasks/:id/comments/:commentId
  .delete("/:id/comments/:commentId", validate("param", commentParamSchema), async (c) => {
    const { id, commentId } = c.req.valid("param");
    const user              = c.get("user");
    await taskService.deleteComment(id, commentId, user.userId, user.role);
    return ok(c, null, "ลบ comment สำเร็จ");
  })

  // ── Attachments ───────────────────────────────────────────────────────────────

  // GET /tasks/:id/attachments
  .get("/:id/attachments", validate("param", idParamSchema), async (c) => {
    const { id }      = c.req.valid("param");
    const attachments = await taskService.listAttachments(id);
    return ok(c, attachments, "ดึงข้อมูล attachment สำเร็จ");
  })

  // POST /tasks/:id/attachments (multipart/form-data)
  .post("/:id/attachments", validate("param", idParamSchema), async (c) => {
    const { id }   = c.req.valid("param");
    const user     = c.get("user");
    const body     = await c.req.parseBody();
    const file     = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: "กรุณาส่งไฟล์", error: "VALIDATION_ERROR" }, 400);
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const attachment = await taskService.uploadAttachment(id, user.userId, {
      buffer,
      name:     file.name,
      mimeType: file.type || "application/octet-stream",
      size:     file.size,
    });
    return created(c, attachment, "อัปโหลดไฟล์สำเร็จ");
  })

  // DELETE /tasks/:id/attachments/:attachmentId
  .delete("/:id/attachments/:attachmentId", validate("param", attachmentParamSchema), async (c) => {
    const { id, attachmentId } = c.req.valid("param");
    const user                 = c.get("user");
    await taskService.deleteAttachment(id, attachmentId, user.userId, user.role);
    return ok(c, null, "ลบ attachment สำเร็จ");
  })

  // ── Time Tracking ─────────────────────────────────────────────────────────────

  // POST /tasks/:id/time/start
  .post("/:id/time/start", validate("param", idParamSchema), async (c) => {
    const { id }  = c.req.valid("param");
    const user    = c.get("user");
    const session = await taskService.startTime(id, user.userId);
    return created(c, session, "เริ่ม time tracking สำเร็จ");
  })

  // POST /tasks/:id/time/pause
  .post("/:id/time/pause", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const user   = c.get("user");
    const result = await taskService.pauseTime(id, user.userId);
    return ok(c, result, "หยุด time tracking สำเร็จ");
  })

  // POST /tasks/:id/time/complete
  .post("/:id/time/complete", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const user   = c.get("user");
    const task   = await taskService.completeTime(id, user.userId);
    return ok(c, task, "เสร็จสิ้น task สำเร็จ");
  })

  // GET /tasks/time/daily?start=YYYY-MM-DD&end=YYYY-MM-DD
  .get("/time/daily", validate("query", calendarQuerySchema), async (c) => {
    const { start, end } = c.req.valid("query");
    const user           = c.get("user");
    const rows           = await taskService.getDailyTime(start, end, user.userId, user.role);
    return ok(c, rows, "ดึงข้อมูล daily time สำเร็จ");
  })

  // GET /tasks/time/running (get all running timers for current user)
  .get("/time/running", async (c) => {
    const user = c.get("user");
    const sessions = await taskService.getRunningSessions(user.userId);
    return ok(c, sessions, "ดึงข้อมูล session ที่กำลังทำงานสำเร็จ");
  })

  // GET /tasks/:id/time
  .get("/:id/time", validate("param", idParamSchema), async (c) => {
    const { id }     = c.req.valid("param");
    const sessions   = await taskService.getTimeSessions(id);
    return ok(c, sessions, "ดึงข้อมูล time sessions สำเร็จ");
  })

  // POST /tasks/:id/time/log — manual time entry
  .post("/:id/time/log", validate("param", idParamSchema), validate("json", logTimeSchema), async (c) => {
    const { id }  = c.req.valid("param");
    const data    = c.req.valid("json");
    const user    = c.get("user");
    const session = await taskService.logTimeManual(id, user.userId, data);
    return created(c, session, "บันทึกเวลาสำเร็จ");
  })

  // DELETE /tasks/:id/time/:sessionId
  .delete("/:id/time/:sessionId", validate("param", timeSessionParamSchema), async (c) => {
    const { id, sessionId } = c.req.valid("param");
    const user              = c.get("user");
    await taskService.deleteTimeSession(id, sessionId, user.userId, user.role);
    return ok(c, null, "ลบ session สำเร็จ");
  })

  // ── Extension Requests (per task) ────────────────────────────────────────────

  // GET /tasks/:id/extension-requests
  .get("/:id/extension-requests", validate("param", idParamSchema), async (c) => {
    const { id }     = c.req.valid("param");
    const extensions = await taskService.listExtensionRequests(id);
    return ok(c, extensions, "ดึงข้อมูล extension requests สำเร็จ");
  })

  // ── Rework ────────────────────────────────────────────────────────────────────

  // GET /tasks/:id/rework
  .get("/:id/rework", validate("param", idParamSchema), async (c) => {
    const { id }  = c.req.valid("param");
    const events  = await taskService.listReworkEvents(id);
    return ok(c, events, "ดึงข้อมูล rework สำเร็จ");
  })

  // POST /tasks/:id/rework — admin/manager only
  .post("/:id/rework", validate("param", idParamSchema), validate("json", createReworkSchema), async (c) => {
    const { id }  = c.req.valid("param");
    const data    = c.req.valid("json");
    const user    = c.get("user");
    if (user.role !== "admin" && user.role !== "manager") {
      return c.json({ success: false, message: "ไม่มีสิทธิ์ส่งกลับแก้ไข", error: "FORBIDDEN" }, 403);
    }
    const event = await taskService.createReworkEvent(id, user.userId, data);
    return created(c, event, "ส่งกลับแก้ไขสำเร็จ");
  })

  // PATCH /tasks/:id/move — admin/manager only
  .patch("/:id/move", validate("param", idParamSchema), validate("json", moveTaskSchema), async (c) => {
    const { id } = c.req.valid("param");
    const data   = c.req.valid("json");
    const user   = c.get("user");
    if (user.role !== "admin" && user.role !== "manager") {
      return c.json({ success: false, message: "ไม่มีสิทธิ์ย้าย task", error: "FORBIDDEN" }, 403);
    }
    const task = await taskService.moveTask(id, data.toListId);
    return ok(c, task, "ย้าย task สำเร็จ");
  })

  // POST /tasks/:id/extension-requests
  .post("/:id/extension-requests", validate("param", idParamSchema), validate("json", createExtensionRequestSchema), async (c) => {
    const { id }    = c.req.valid("param");
    const data      = c.req.valid("json");
    const user      = c.get("user");
    const extension = await taskService.createExtensionRequest(id, user.userId, data);
    return created(c, extension, "สร้างคำขอขยายเวลาสำเร็จ");
  })

  // POST /tasks/bulk — multi-select batch update (admin/manager only)
  .post("/bulk", validate("json", z.object({
    taskIds: z.array(z.string().uuid()).min(1).max(50),
    updates: z.object({
      listStatusId: z.string().uuid().optional(),
      priority:     z.enum(["low","normal","high","urgent"]).optional(),
      assigneeId:   z.string().uuid().optional(),
      deadline:     z.string().optional().nullable(),
    }),
  })), async (c) => {
    const user = c.get("user");
    if (user.role !== "admin" && user.role !== "manager") {
      return c.json({ success: false, message: "ไม่มีสิทธิ์", error: "FORBIDDEN" }, 403);
    }
    const body = c.req.valid("json" as never) as any;
    const result = await taskService.bulkUpdate(body.taskIds, body.updates);
    return ok(c, result, `อัปเดต ${result.updated} จาก ${result.total} task สำเร็จ`);
  });
