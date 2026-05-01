// ─────────────────────────────────────────────────────────────────────────────
// LINE AI Assistant — AI-powered personal assistant via LINE.
// Phase 2.4d — every employee has a secretary that understands natural Thai.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { chatComplete, type ChatMessage, type Tool, type ToolCall } from "@/lib/openrouter.ts";
import { replyText, replyTextWithQuickReplies, pushFlex, buildTaskListFlex, buildTaskCarouselBubble, buildHelpFlex, buildConfirmBubble } from "@/lib/line.ts";
import { logger } from "@/lib/logger.ts";

// Use same model as main chat by default — overridable via env
const LINE_MODEL = process.env.OPENROUTER_LINE_MODEL ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-sonnet";

interface LineUser {
  employeeId: string;
  name: string;
  role: string;
}

// ── User resolution ────────────────────────────────────────────────────────

async function resolveLineUser(lineUserId: string): Promise<LineUser | null> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT e.id::text AS employee_id, e.name, COALESCE(r.name, 'employee') AS role
    FROM user_channels uc
    JOIN employees e ON uc.employee_id = e.id
    LEFT JOIN roles r ON e.role_id = r.id
    WHERE uc.channel = 'line'
      AND uc.identifier = '${lineUserId.replace(/'/g, "''")}'
      AND uc.verified_at IS NOT NULL
      AND e.is_active = true
    LIMIT 1
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0];
  if (!r) return null;
  return { employeeId: String(r.employee_id), name: String(r.name ?? ""), role: String(r.role ?? "employee") };
}

// ── Conversation memory ────────────────────────────────────────────────────

async function saveMessage(lineUserId: string, userId: string, role: "user" | "assistant", content: string, toolCalls?: string[]): Promise<void> {
  await db.execute(sql.raw(`
    INSERT INTO line_messages (line_user_id, employee_id, role, content, tool_calls)
    VALUES ('${lineUserId.replace(/'/g, "''")}', '${userId}'::uuid, '${role}',
            '${content.replace(/'/g, "''").slice(0, 2000)}',
            ${toolCalls?.length ? `'${JSON.stringify(toolCalls).replace(/'/g, "''")}'::jsonb` : "NULL"})
  `));
}

async function loadHistory(lineUserId: string): Promise<ChatMessage[]> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT role, content FROM line_messages
    WHERE line_user_id = '${lineUserId.replace(/'/g, "''")}'
    ORDER BY created_at DESC LIMIT 8
  `));
  const arr = ((rows as any).rows ?? rows) as Array<{ role: string; content: string }>;
  return arr.reverse().map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Scope helpers
// ═══════════════════════════════════════════════════════════════════════════

function taskScope(user: LineUser): string {
  if (user.role === "admin") return "";
  return `AND (t.assignee_id = '${user.employeeId}'::uuid OR EXISTS (
    SELECT 1 FROM employees e2 WHERE e2.id = t.assignee_id AND e2.manager_id = '${user.employeeId}'::uuid))`;
}

function employeeScope(user: LineUser): string {
  if (user.role === "admin") return "";
  return `AND (e.id = '${user.employeeId}'::uuid OR e.manager_id = '${user.employeeId}'::uuid)`;
}

async function resolveTargetEmployee(name: string, user: LineUser): Promise<{ id: string; name: string } | null> {
  if (!name || name === "ฉัน" || name === "ตัวเอง" || name === "me") {
    return { id: user.employeeId, name: user.name };
  }
  const escaped = name.replace(/'/g, "''");
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT e.id::text, e.name FROM employees e WHERE e.is_active = true
      AND (e.name ILIKE '%${escaped}%' OR e.employee_code ILIKE '%${escaped}%')
      ${employeeScope(user)}
    LIMIT 1
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0];
  return r ? { id: String(r.id), name: String(r.name) } : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — 7 tools, all scope-enforced
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Scope helpers
// ═══════════════════════════════════════════════════════════════════════════

function employeeScope(user: LineUser): string {
  if (user.role === "admin") return "";
  return `AND (e.id = '${user.employeeId}'::uuid OR e.manager_id = '${user.employeeId}'::uuid)`;
}

async function resolveTargetEmployee(name: string, user: LineUser): Promise<{ id: string; name: string } | null> {
  if (!name || name === "ฉัน" || name === "ตัวเอง" || name === "me") {
    return { id: user.employeeId, name: user.name };
  }
  const escaped = name.replace(/'/g, "''");
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT e.id::text, e.name FROM employees e WHERE e.is_active = true
      AND (e.name ILIKE '%${escaped}%' OR e.employee_code ILIKE '%${escaped}%')
      ${employeeScope(user)}
    LIMIT 1
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0];
  return r ? { id: String(r.id), name: String(r.name) } : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOLS — 7 tools, all scope-enforced
// ═══════════════════════════════════════════════════════════════════════════

async function toolGetMySummary(args: any, user: LineUser): Promise<string> {
  const target = await resolveTargetEmployee(String(args.employee_name ?? ""), user);
  if (!target) return JSON.stringify({ error: `ไม่พบบุคคล "${args.employee_name}" ในขอบเขตของคุณ` });

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT COUNT(*)::int AS total,
      COUNT(CASE WHEN completed_at IS NULL AND deadline IS NOT NULL AND deadline < NOW() THEN 1 END)::int AS overdue,
      COUNT(CASE WHEN completed_at IS NULL AND deadline IS NOT NULL AND deadline >= NOW() AND deadline <= NOW() + INTERVAL '1 day' THEN 1 END)::int AS due_today,
      COUNT(CASE WHEN completed_at IS NULL THEN 1 END)::int AS active,
      COALESCE(SUM(time_estimate_hours)::numeric(5,1), 0) AS estimated_hours
    FROM tasks WHERE assignee_id = '${target.id}'::uuid AND deleted_at IS NULL
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0] ?? {};
  return JSON.stringify({ name: target.name, ...r });
}

async function toolGetMyTasks(args: any, user: LineUser): Promise<string> {
  const target = await resolveTargetEmployee(String(args.employee_name ?? ""), user);
  if (!target) return JSON.stringify({ error: `ไม่พบบุคคล "${args.employee_name}" ในขอบเขตของคุณ` });

  const status = String(args.status ?? "incomplete");
  const limit = Math.min(Number(args.limit ?? 8), 10);
  let statusClause = "";
  if (status === "overdue") statusClause = "AND t.completed_at IS NULL AND t.deadline IS NOT NULL AND t.deadline < NOW()";
  else if (status === "incomplete") statusClause = "AND t.completed_at IS NULL";
  else if (status === "done") statusClause = "AND t.completed_at IS NOT NULL";
  else if (status === "due_today") statusClause = "AND t.completed_at IS NULL AND t.deadline >= NOW() AND t.deadline < ((CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')";

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.display_id, t.title, t.deadline::text AS deadline, t.time_estimate_hours::text AS estimated_hours,
           CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.completed_at IS NULL THEN true ELSE false END AS is_overdue
    FROM tasks t
    WHERE t.assignee_id = '${target.id}'::uuid AND t.deleted_at IS NULL ${statusClause}
    ORDER BY CASE WHEN t.deadline < NOW() AND t.completed_at IS NULL THEN 0 ELSE 1 END, t.deadline ASC NULLS LAST
    LIMIT ${limit}
  `));
  const tasks = ((rows as any).rows ?? rows) as any[];
  return JSON.stringify({ employee: target.name, status, count: tasks.length, tasks });
}

async function toolStartTimer(args: any, user: LineUser): Promise<string> {
  const displayId = String(args.display_id ?? "");

  // Check existing running timer first
  const runningRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT ts.task_id::text, t.display_id FROM task_time_sessions ts
    JOIN tasks t ON ts.task_id = t.id
    WHERE ts.employee_id = '${user.employeeId}'::uuid AND ts.ended_at IS NULL LIMIT 1
  `));
  const running = (((runningRows as any).rows ?? runningRows) as any[])[0];
  if (running) {
    return JSON.stringify({ error: `⏱️ กำลังจับเวลา [${running.display_id ?? "?"}] อยู่ — หยุดก่อนเริ่มงานใหม่` });
  }

  // If no display_id specified → return available tasks for carousel
  if (!displayId) {
    const tRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT display_id, title, deadline::text AS deadline,
             CASE WHEN deadline IS NOT NULL AND deadline < NOW() THEN true ELSE false END AS is_overdue
      FROM tasks WHERE assignee_id = '${user.employeeId}'::uuid AND deleted_at IS NULL AND completed_at IS NULL
      ORDER BY CASE WHEN deadline < NOW() THEN 0 ELSE 1 END, deadline ASC NULLS LAST LIMIT 10
    `));
    const tasks = ((tRows as any).rows ?? tRows) as any[];
    if (tasks.length === 0) return JSON.stringify({ error: "ไม่มีงานค้างให้เริ่ม — ว่างแล้ว!" });
    if (tasks.length === 1) {
      // Auto-start single task
      const t = tasks[0];
      await db.execute(sql.raw(`
        INSERT INTO task_time_sessions (task_id, employee_id, started_at)
        VALUES ((SELECT id FROM tasks WHERE display_id = '${String(t.display_id).replace(/'/g, "''")}' AND assignee_id = '${user.employeeId}'::uuid LIMIT 1), '${user.employeeId}'::uuid, NOW())
      `));
      return JSON.stringify({ success: true, display_id: String(t.display_id), title: String(t.title), auto: true });
    }
    // Multiple tasks — carousel
    return JSON.stringify({ carousel: true, tasks: tasks.map((t: any) => ({
      display_id: t.display_id, title: t.title, deadline: t.deadline, is_overdue: t.is_overdue,
    })) });
  }

  // Find task — scope: only user's own tasks (even managers can only time themselves)
  const tRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT id::text, display_id, title FROM tasks
    WHERE display_id = '${displayId.replace(/'/g, "''")}'
      AND assignee_id = '${user.employeeId}'::uuid AND deleted_at IS NULL AND completed_at IS NULL
    LIMIT 1
  `));
  const task = (((tRows as any).rows ?? tRows) as any[])[0];
  if (!task) return JSON.stringify({ error: `ไม่พบงาน ${displayId} — อาจปิดไปแล้วหรือไม่ใช่งานของคุณ` });

  await db.execute(sql.raw(`
    INSERT INTO task_time_sessions (task_id, employee_id, started_at)
    VALUES ('${task.id}'::uuid, '${user.employeeId}'::uuid, NOW())
  `));
  return JSON.stringify({ success: true, task_id: String(task.id), display_id: String(task.display_id), title: String(task.title) });
}

async function toolStopTimer(_args: any, user: LineUser): Promise<string> {
  // timer is always personal
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    UPDATE task_time_sessions SET ended_at = NOW(),
      duration_min = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int
    WHERE employee_id = '${user.employeeId}'::uuid AND ended_at IS NULL
    RETURNING task_id::text, duration_min::int, started_at::text
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0];
  if (!r) return JSON.stringify({ error: "ยังไม่ได้เริ่มจับเวลา — พูด 'เริ่มงาน' เพื่อเริ่ม" });

  const tRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT display_id, title FROM tasks WHERE id = '${r.task_id}'::uuid LIMIT 1
  `));
  const t = (((tRows as any).rows ?? tRows) as any[])[0];
  const hours = Math.round(Number(r.duration_min) / 6) / 10;
  return JSON.stringify({ success: true, display_id: t?.display_id ?? "?", title: t?.title ?? "", duration_hours: hours, duration_minutes: Number(r.duration_min) });
}

async function toolMarkDone(args: any, user: LineUser): Promise<string> {
  const identifier = String(args.identifier ?? "").replace(/'/g, "''");
  if (!identifier) return JSON.stringify({ error: "ต้องระบุ task — เช่น 'ปิด TK-001' หรือ 'ปิด logo'" });

  // mark_done — only own tasks (even managers)
  const tRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.id::text, t.display_id, t.title, t.list_id::text FROM tasks t
    WHERE t.assignee_id = '${user.employeeId}'::uuid AND t.deleted_at IS NULL AND t.completed_at IS NULL
      AND (t.display_id = '${identifier}' OR t.title ILIKE '%${identifier}%')
    ORDER BY CASE WHEN t.display_id = '${identifier}' THEN 0 ELSE 1 END, t.created_at DESC LIMIT 1
  `));
  const task = (((tRows as any).rows ?? tRows) as any[])[0];
  if (!task) return JSON.stringify({ error: `ไม่พบงานที่ตรงกับ "${identifier}" — เช็คชื่อหรือเลข task อีกครั้ง` });

  const sRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT id::text, name FROM list_statuses
    WHERE list_id = '${task.list_id}'::uuid AND status_type = 'done' ORDER BY display_order LIMIT 1
  `));
  const status = (((sRows as any).rows ?? sRows) as any[])[0];

  await db.execute(sql.raw(`
    UPDATE task_time_sessions SET ended_at = NOW(),
      duration_min = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int
    WHERE employee_id = '${user.employeeId}'::uuid AND task_id = '${task.id}'::uuid AND ended_at IS NULL
  `));
  await db.execute(sql.raw(`
    UPDATE tasks SET completed_at = NOW(), list_status_id = ${status ? `'${status.id}'::uuid` : "list_status_id"}, updated_at = NOW()
    WHERE id = '${task.id}'::uuid
  `));
  return JSON.stringify({ success: true, display_id: String(task.display_id), title: String(task.title) });
}

async function toolGetMyTime(_args: any, user: LineUser): Promise<string> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN duration_min ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))/60)::int END), 0)::int AS minutes,
           COUNT(*)::int AS sessions
    FROM task_time_sessions
    WHERE employee_id = '${user.employeeId}'::uuid
      AND (started_at AT TIME ZONE 'Asia/Bangkok')::date = (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0] ?? {};
  const hours = Math.round(Number(r.minutes || 0) / 6) / 10;
  return JSON.stringify({ hours_logged: hours, sessions: Number(r.sessions || 0), minutes: Number(r.minutes || 0) });
}

async function toolGetTeamWorkload(_args: any, user: LineUser): Promise<string> {
  if (user.role !== "manager" && user.role !== "admin") {
    return JSON.stringify({ error: "คุณไม่มีสิทธิ์ดูข้อมูลทีม" });
  }
  const scope = user.role === "admin" ? "" : `AND (e.id = '${user.employeeId}'::uuid OR e.manager_id = '${user.employeeId}'::uuid)`;

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT e.name,
      COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.completed_at IS NULL)::int AS active_tasks,
      COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.deadline IS NOT NULL AND t.deadline < NOW() AND t.completed_at IS NULL)::int AS overdue,
      COALESCE(SUM(t.time_estimate_hours) FILTER (WHERE t.id IS NOT NULL)::numeric(5,1), 0) AS estimated_hours
    FROM employees e
    LEFT JOIN tasks t ON t.assignee_id = e.id AND t.deleted_at IS NULL
    WHERE e.is_active = true ${scope}
    GROUP BY e.id, e.name ORDER BY active_tasks DESC
  `));
  const arr = ((rows as any).rows ?? rows) as any[];
  return JSON.stringify({
    scope: user.role === "admin" ? "ทั้งหมด" : "ทีมของคุณ",
    members: arr.map((r: any) => ({
      name: r.name, active_tasks: Number(r.active_tasks ?? 0),
      overdue: Number(r.overdue ?? 0), estimated_hours: Number(r.estimated_hours ?? 0),
    })),
  });
}

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_my_summary",
      description: "ดูภาพรวมงาน: จำนวนงานทั้งหมด, เกินกำหนด, ครบวันนี้, ที่กำลังทำ, ชม.ที่ประมาณไว้ — ใช้ employee_name เพื่อดูของคนอื่นได้ (ถ้ามีสิทธิ์)",
      parameters: {
        type: "object",
        properties: {
          employee_name: { type: "string", description: "ชื่อพนักงาน หรือเว้นว่าง/ใช้ 'ฉัน' สำหรับตัวเอง — หัวหน้าดูทีมได้ admin ดูทั้งหมดได้" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_tasks",
      description: "ดูรายการงานตามสถานะ พร้อม display_id, title, deadline — ใช้ employee_name เพื่อดูของคนอื่นได้ (ถ้ามีสิทธิ์)",
      parameters: {
        type: "object",
        properties: {
          employee_name: { type: "string", description: "ชื่อพนักงาน หรือเว้นว่าง/ใช้ 'ฉัน' สำหรับตัวเอง" },
          status:        { type: "string", description: "incomplete | overdue | done | due_today | all" },
          limit:         { type: "integer", description: "จำนวนสูงสุด (default 8)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_timer",
      description: "เริ่มจับเวลาสำหรับงานของตัวเอง โดยระบุ display_id — จับเวลาได้เฉพาะงานของตัวเองเท่านั้น",
      parameters: {
        type: "object",
        properties: {
          display_id: { type: "string", description: "display_id เช่น TK-001" },
        },
        required: ["display_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stop_timer",
      description: "หยุดจับเวลาที่กำลังทำงานอยู่ — หยุด timer ของตัวเองและบันทึกชั่วโมง",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_done",
      description: "ปิดงานของตัวเอง — ทำเครื่องหมายว่าเสร็จแล้ว โดยระบุ display_id หรือคำในชื่อเรื่อง",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "display_id (เช่น TK-001) หรือคำในชื่อเรื่อง (เช่น 'logo')" },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_time",
      description: "ดูชั่วโมงที่ log วันนี้ — ทำงานไปกี่ชั่วโมง กี่ session",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_workload",
      description: "ดูภาระงานของทีม — แต่ละคนมีงานค้างกี่งาน เกินกำหนดกี่งาน (สำหรับหัวหน้าและ admin เท่านั้น)",
      parameters: { type: "object", properties: {} },
    },
  },
];

const TOOL_EXECUTORS: Record<string, (args: any, user: LineUser) => Promise<string>> = {
  get_my_summary:   toolGetMySummary,
  get_my_tasks:     toolGetMyTasks,
  start_timer:      toolStartTimer,
  stop_timer:       toolStopTimer,
  mark_done:        toolMarkDone,
  get_my_time:      toolGetMyTime,
  get_team_workload: toolGetTeamWorkload,
};

// ═══════════════════════════════════════════════════════════════════════════
// Main handler — called from line.service.ts
// ═══════════════════════════════════════════════════════════════════════════

export const lineAiService = {
  /**
   * Process a text message from LINE user.
   */
  async processMessage(lineUserId: string, text: string, replyToken: string): Promise<void> {
    const user = await resolveLineUser(lineUserId);
    if (!user) {
      await replyText(replyToken, "👋 ยังไม่ได้ผูกบัญชี — ไปที่ Xiqma → Settings → Notifications → ผูก LINE ก่อน");
      return;
    }

    const cleanText = text.trim();
    if (!cleanText) return;

    // Quick check: help command → respond immediately, no AI needed
    if (/^(ช่วย|help|คำสั่ง|menu)$/i.test(cleanText)) {
      await pushFlex(lineUserId, { altText: "คำสั่ง Xiqma", contents: buildHelpFlex(user.role) });
      await saveMessage(lineUserId, user.employeeId, "user", cleanText);
      await saveMessage(lineUserId, user.employeeId, "assistant", "แสดงคำสั่ง");
      return;
    }

    // Morning greeting — first message of the day → auto summary
    const todayCount = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM line_messages
      WHERE line_user_id = '${lineUserId.replace(/'/g, "''")}'
        AND created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')
    `));
    const isFirstToday = Number((((todayCount as any).rows ?? todayCount) as any[])[0]?.cnt ?? 0) === 0;

    // Save user message
    await saveMessage(lineUserId, user.employeeId, "user", cleanText);

    // Load history
    const history = await loadHistory(lineUserId);

    const systemPrompt = `คุณคือผู้ช่วยส่วนตัวใน LINE ของพนักงาน Xiqma — คุณตอบแบบข้อความ LINE จริงๆ ไม่ใช่บันทึกช่วยจำ
ชื่อผู้ใช้: ${user.name} (${user.role === "admin" ? "admin — ดูได้ทั้งหมด" : user.role === "manager" ? "หัวหน้า — ดูของตัวเอง+ทีมได้" : "พนักงาน — ดูของตัวเองเท่านั้น"})

กฎสำคัญ (ห้ามละเมิด):
0. ห้ามพูดคิดในใจเด็ดขาด — user เห็นทุกคำที่พิมพ์ ห้ามใช้ "ผู้ใช้ถาม" "ฉันจะ" "ดูข้อมูล" "ก่อนอื่น" — ตอบผลลัพธ์ตรงๆ
1. ตอบสั้น ตรงประเด็น — 1-3 ประโยคพอ
2. ภาษาไทย เป็นกันเอง ใช้ emoji ได้นิดหน่อย
3. เรียก tool ทันที — ไม่ต้องถามย้ำ
6. ${user.role === "admin" ? "คุณคือ admin — ดูข้อมูลทุกคนได้" : user.role === "manager" ? "คุณคือหัวหน้า — ดูของตัวเอง+ทีมได้ ใช้ employee_name" : "คุณคือพนักงาน — ดูของตัวเองเท่านั้น"}
7. จับเวลา/ปิดงาน: ทำได้เฉพาะงานของตัวเองเสมอ
8. ถ้าถามนอกขอบเขต → "คุณไม่มีสิทธิ์ดูข้อมูลนี้ค่ะ"
9. 💡 ถ้าคำถามต้องการข้อมูลหลายอย่าง → เรียกทุก tool ที่จำเป็นพร้อมกันได้เลย
${isFirstToday ? `\n⚠️ ข้อความแรกของวัน — ทักทายตอนเช้า + สรุปงานวันนี้สั้นๆ ก่อนตอบ` : ""}`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: cleanText },
    ];

    try {
      const MAX_ROUNDS = parseInt(process.env.AI_QA_MAX_ROUNDS ?? "3", 10);

      // First attempt — with tools (model might support function calling)
      let result = await chatComplete({
        messages,
        model: LINE_MODEL,
        temperature: 0.3,
        maxTokens: 800,
        tools: TOOLS,
      }).catch(async (err) => {
        if (err?.message?.includes("400") || err?.message?.includes("tool")) {
          return await chatComplete({ messages, model: LINE_MODEL, temperature: 0.3, maxTokens: 800 });
        }
        throw err;
      });

      let finalText = result.text || "";
      const allToolNames: string[] = [];

      // Multi-round tool loop
      for (let round = 1; round <= MAX_ROUNDS && result.toolCalls?.length; round++) {
        // Execute all tool calls in parallel
        const toolResults = await Promise.all(
          result.toolCalls!.map(async (tc) => {
            const executor = TOOL_EXECUTORS[tc.function.name];
            if (!executor) return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify({ error: `unknown: ${tc.function.name}` }) };
            allToolNames.push(tc.function.name);
            try {
              const args = JSON.parse(tc.function.arguments || "{}");
              return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: await executor(args, user) };
            } catch (err) {
              logger.error({ err, tool: tc.function.name }, "line tool failed");
              return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify({ error: (err as any)?.message }) };
            }
          })
        );

        // Append to conversation
        messages.push({ role: "assistant", content: result.text || "", tool_calls: result.toolCalls! });
        messages.push(...toolResults);

        // Call LLM again — might return more tool calls or final answer
        result = await chatComplete({
          messages,
          model: LINE_MODEL,
          temperature: 0.3,
          maxTokens: 500,
          ...(round < MAX_ROUNDS ? { tools: TOOLS } : {}), // last round: force text, no more tools
        });

        finalText = result.text || finalText;
      }

      // Process Flex responses based on last tool calls
      const lastTools = allToolNames;
      const mainTool = lastTools[0];

      // Carousel for start_timer
      if (mainTool === "start_timer" && lastTools.length === 1) {
        try {
          // Check last tool result for carousel flag
          const lastMsg = messages[messages.length - 1]?.content;
          const data = lastMsg ? JSON.parse(String(lastMsg)) : null;
          if (data?.carousel && data.tasks?.length > 0) {
            await pushFlex(lineUserId, {
              altText: `เลือกงาน (${data.tasks.length})`,
              contents: { type: "carousel", contents: data.tasks.map((t: any) => buildTaskCarouselBubble({ task: t })) },
            });
            await saveMessage(lineUserId, user.employeeId, "assistant", "แสดง carousel", lastTools);
            return;
          }
        } catch {}
      }

      // Flex for task list
      if (mainTool === "get_my_tasks") {
        try {
          // Find the tool result in messages
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role !== "tool" || messages[i].name !== "get_my_tasks") continue;
            const data = JSON.parse(messages[i].content);
            if (data.tasks?.length > 0) {
              await pushFlex(lineUserId, {
                altText: finalText.slice(0, 300),
                contents: buildTaskListFlex({ headerText: `📋 งานของ${user.name} (${data.count})`, tasks: data.tasks }),
              });
              await saveMessage(lineUserId, user.employeeId, "assistant", finalText, lastTools);
              return;
            }
          }
        } catch {}
      }

      // Confirm bubble for done/start/stop
      const confirmActions: Record<string, string> = { mark_done: "✅", start_timer: "▶️", stop_timer: "⏸️" };
      if (mainTool && confirmActions[mainTool]) {
        try {
          const lastMsg = messages[messages.length - 1]?.content;
          const data = lastMsg ? JSON.parse(String(lastMsg)) : null;
          if (data?.success) {
            await pushFlex(lineUserId, {
              altText: finalText.slice(0, 300),
              contents: buildConfirmBubble({ emoji: confirmActions[mainTool], message: finalText }),
            });
            await saveMessage(lineUserId, user.employeeId, "assistant", finalText, lastTools);
            return;
          }
        } catch {}
      }

      await saveMessage(lineUserId, user.employeeId, "assistant", finalText, lastTools);

      await replyTextWithQuickReplies(replyToken, finalText.slice(0, 4800), [
        { label: "📋 งานวันนี้", text: "งานวันนี้" },
        { label: "⏸️ หยุด", text: "หยุด" },
        { label: "📊 เวลา", text: "เวลา" },
        { label: "❓ ช่วย", text: "ช่วย" },
      ]);

    } catch (err: any) {
      const msg = err?.message ?? err?.toString?.() ?? String(err ?? "unknown");
      logger.error({ errMsg: msg, lineUserId }, "line-ai.service failed");
      await replyText(replyToken, "ขออภัย ระบบขัดข้อง — ลองใหม่ในอีกสักครู่");
    }
  },

  /**
   * Process a postback event (inline button click).
   */
  async processPostback(lineUserId: string, data: string, replyToken: string): Promise<void> {
    const user = await resolveLineUser(lineUserId);
    if (!user) return;

    const parts = data.split("_");
    const action = parts[0];
    const value = parts.slice(1).join("_");

    try {
      if (action === "done" && value) {
        const result = await toolMarkDone({ identifier: value }, user);
        const parsed = JSON.parse(result);
        if (parsed.success) {
          await replyText(replyToken, `✅ [${parsed.display_id}] ${parsed.title} — เสร็จแล้ว 🎉`);
        } else {
          await replyText(replyToken, parsed.error || "ไม่สามารถปิดงานได้");
        }
      } else if (action === "start" && value) {
        const result = await toolStartTimer({ display_id: value }, user);
        const parsed = JSON.parse(result);
        if (parsed.success) {
          await replyText(replyToken, `▶️ เริ่มจับเวลา [${parsed.display_id}] ${parsed.title} แล้ว`);
        } else {
          await replyText(replyToken, parsed.error || "ไม่สามารถเริ่มจับเวลาได้");
        }
      }

      await saveMessage(lineUserId, user.employeeId, "user", `[กดปุ่ม: ${data}]`);
    } catch (err: any) {
      logger.error({ errMsg: err?.message ?? String(err), data }, "line postback failed");
      await replyText(replyToken, "ขออภัย ไม่สามารถดำเนินการได้");
    }
  },
};
