// ─────────────────────────────────────────────────────────────────────────────
// NL Q&A Service — natural language question answering via Claude tool-use.
// Phase 2.10b — comprehensive tools, team-scoped for managers, all-data for admin.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { chatComplete, type ChatMessage, type Tool, type ToolCall } from "@/lib/openrouter.ts";
import { logger } from "@/lib/logger.ts";

interface UserContext {
  userId: string;
  role: string;
  name: string;
}

// ── Scope helper — SQL fragment to limit to user's team ────────────────────
function teamScope(ctx: UserContext): string {
  if (ctx.role === "admin") return "";
  // Manager sees self + own direct reports
  return `AND (e.manager_id = '${ctx.userId}'::uuid OR e.id = '${ctx.userId}'::uuid)`;
}

function taskScope(ctx: UserContext, alias = "t"): string {
  if (ctx.role === "admin") return "";
  return `AND (${alias}.assignee_id = '${ctx.userId}'::uuid OR EXISTS (SELECT 1 FROM employees e2 WHERE e2.id = ${alias}.assignee_id AND e2.manager_id = '${ctx.userId}'::uuid))`;
}

// ── Helper — fuzzy resolve employee name to ID ─────────────────────────────
async function resolveEmployee(name: string, ctx: UserContext): Promise<{ id: string; name: string } | null> {
  if (name === "ฉัน" || name === "me" || name === "ผม" || name === "ตัวเอง") {
    return { id: ctx.userId, name: ctx.name };
  }
  const escaped = name.replace(/'/g, "''");
  const scope = teamScope(ctx);
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT id::text, name FROM employees
    WHERE is_active = true
      AND (name ILIKE '%${escaped}%' OR employee_code ILIKE '%${escaped}%')
      ${scope}
    LIMIT 1
  `));
  const arr = ((rows as any).rows ?? rows) as any[];
  if (arr.length === 0) return null;
  return { id: String(arr[0].id), name: String(arr[0].name) };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 1: get_my_summary — quick summary for the current user
// ═══════════════════════════════════════════════════════════════════════════
async function execGetMySummary(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT
      COUNT(*)::int AS total_assigned,
      COUNT(CASE WHEN completed_at IS NULL AND deadline IS NOT NULL AND deadline < NOW()
            THEN 1 END)::int AS overdue,
      COUNT(CASE WHEN completed_at IS NULL AND deadline IS NOT NULL AND deadline >= NOW() AND deadline <= NOW() + INTERVAL '1 day'
            THEN 1 END)::int AS due_today,
      COUNT(CASE WHEN completed_at IS NULL THEN 1 END)::int AS incomplete,
      COUNT(CASE WHEN completed_at IS NOT NULL AND (completed_at AT TIME ZONE 'Asia/Bangkok')::date = (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date
            THEN 1 END)::int AS done_today,
      COALESCE(SUM(time_estimate_hours)::numeric(6,1), 0) AS estimated_hours,
      COALESCE((
        SELECT SUM(duration_min) / 60.0 FROM task_time_sessions
        WHERE employee_id = '${ctx.userId}'::uuid
          AND (started_at AT TIME ZONE 'Asia/Bangkok')::date = (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date
      )::numeric(6,1), 0) AS hours_logged_today
    FROM tasks
    WHERE assignee_id = '${ctx.userId}'::uuid AND deleted_at IS NULL
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0];
  return JSON.stringify({
    name: ctx.name,
    total_assigned: r.total_assigned,
    overdue: r.overdue,
    due_today: r.due_today,
    incomplete: r.incomplete,
    done_today: r.done_today,
    estimated_hours: r.estimated_hours,
    hours_logged_today: r.hours_logged_today,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 2: get_employee_tasks — task list for any employee
// ═══════════════════════════════════════════════════════════════════════════
async function execGetEmployeeTasks(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const employeeName = String(args.employee_name ?? "ฉัน");
  const status = String(args.status ?? "incomplete");  // all | incomplete | overdue | done
  const limit = Math.min(Number(args.limit ?? 15), 30);
  const emp = await resolveEmployee(employeeName, ctx);

  if (!emp) {
    return JSON.stringify({ error: `ไม่พบพนักงานชื่อ "${employeeName}" ในขอบเขตของคุณ` });
  }

  let statusClause = "";
  switch (status) {
    case "overdue":
      statusClause = "AND t.completed_at IS NULL AND t.deadline IS NOT NULL AND t.deadline < NOW()";
      break;
    case "incomplete":
      statusClause = "AND t.completed_at IS NULL";
      break;
    case "done":
      statusClause = "AND t.completed_at IS NOT NULL";
      break;
    case "due_today":
      statusClause = `AND t.completed_at IS NULL AND t.deadline IS NOT NULL
        AND t.deadline >= NOW() AND t.deadline < ((CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')`;
      break;
    // "all" — no filter
  }

  const scope = taskScope(ctx, "t");

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.display_id, t.title, t.status,
           t.deadline::text AS deadline,
           COALESCE(t.time_estimate_hours::numeric(5,1), 0) AS estimated_hours,
           CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.completed_at IS NULL
             THEN true ELSE false END AS is_overdue,
           t.completed_at IS NOT NULL AS is_done,
           EXTRACT(DAY FROM (NOW() - t.deadline))::int AS days_overdue
    FROM tasks t
    JOIN employees e ON t.assignee_id = e.id
    WHERE t.deleted_at IS NULL
      AND e.id = '${emp.id}'::uuid
      ${statusClause}
      ${scope}
    ORDER BY t.deadline ASC NULLS LAST, t.created_at DESC
    LIMIT ${limit}
  `));
  const arr = ((rows as any).rows ?? rows) as any[];

  return JSON.stringify({
    employee: emp.name,
    status_filter: status,
    count: arr.length,
    tasks: arr.map((r: any) => ({
      display_id: r.display_id,
      title: r.title,
      status: r.status,
      deadline: r.deadline,
      estimated_hours: r.estimated_hours,
      is_overdue: r.is_overdue,
      is_done: r.is_done,
      days_overdue: r.days_overdue ?? 0,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 3: get_employee_stats — aggregate stats for any employee
// ═══════════════════════════════════════════════════════════════════════════
async function execGetEmployeeStats(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const employeeName = String(args.employee_name ?? "ฉัน");
  const days = Math.min(Number(args.days ?? 30), 90);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const emp = await resolveEmployee(employeeName, ctx);

  if (!emp) {
    return JSON.stringify({ error: `ไม่พบพนักงานชื่อ "${employeeName}" ในขอบเขตของคุณ` });
  }

  const scope = taskScope(ctx, "t");
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT
      COUNT(t.id)::int AS total,
      COUNT(CASE WHEN t.completed_at IS NOT NULL THEN 1 END)::int AS done,
      COUNT(CASE WHEN t.completed_at IS NULL AND t.deadline IS NOT NULL AND t.deadline < NOW()
            THEN 1 END)::int AS overdue,
      COUNT(CASE WHEN t.completed_at IS NULL THEN 1 END)::int AS in_progress,
      CASE WHEN COUNT(t.id) > 0
        THEN ROUND(COUNT(CASE WHEN t.completed_at <= t.deadline OR t.deadline IS NULL THEN 1 END)::numeric
             / NULLIF(COUNT(t.completed_at), 0) * 100, 1)
        ELSE 0 END AS on_time_pct,
      COALESCE((
        SELECT SUM(duration_min) / 60.0 FROM task_time_sessions ts
        WHERE ts.employee_id = '${emp.id}'::uuid
          AND (ts.started_at AT TIME ZONE 'Asia/Bangkok')::date >= '${from}'::date
      )::numeric(6,1), 0) AS hours_logged,
      COALESCE(SUM(t.time_estimate_hours)::numeric(6,1), 0) AS estimated_hours_total
    FROM tasks t
    WHERE t.assignee_id = '${emp.id}'::uuid
      AND t.deleted_at IS NULL
      AND t.created_at >= '${from}'::date
      ${scope}
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0] ?? {};
  return JSON.stringify({
    employee: emp.name,
    period_days: days,
    total: r.total, done: r.done, in_progress: r.in_progress,
    overdue: r.overdue, on_time_pct: r.on_time_pct,
    hours_logged: r.hours_logged,
    estimated_hours_total: r.estimated_hours_total,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 4: search_tasks — keyword search with optional assignee filter
// ═══════════════════════════════════════════════════════════════════════════
async function execSearchTasks(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const query = String(args.query ?? "").replace(/'/g, "''");
  const assigneeName = args.assignee_name ? String(args.assignee_name).replace(/'/g, "''") : null;
  const limit = Math.min(Number(args.limit ?? 10), 20);
  const scope = taskScope(ctx, "t");

  let assigneeClause = "";
  if (assigneeName) {
    assigneeClause = `AND (e.name ILIKE '%${assigneeName}%' OR e.employee_code ILIKE '%${assigneeName}%')`;
  }

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.display_id, t.title, t.status, e.name AS assignee,
           t.deadline::text AS deadline,
           CASE WHEN t.deadline IS NOT NULL AND t.deadline < NOW() AND t.completed_at IS NULL
             THEN true ELSE false END AS is_overdue,
           t.completed_at IS NOT NULL AS is_done
    FROM tasks t
    LEFT JOIN employees e ON t.assignee_id = e.id
    WHERE t.deleted_at IS NULL
      AND t.title ILIKE '%${query}%'
      ${assigneeClause}
      ${scope}
    ORDER BY t.created_at DESC
    LIMIT ${limit}
  `));
  const arr = ((rows as any).rows ?? rows) as any[];

  return JSON.stringify({
    query,
    assignee_filter: assigneeName ?? null,
    results: arr.map((r: any) => ({
      display_id: r.display_id, title: r.title, status: r.status,
      assignee: r.assignee, deadline: r.deadline, is_overdue: r.is_overdue, is_done: r.is_done,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 5: list_overdue — overdue tasks scoped to team
// ═══════════════════════════════════════════════════════════════════════════
async function execListOverdue(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const limit = Math.min(Number(args.limit ?? 20), 40);
  const scope = taskScope(ctx, "t");

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.display_id, t.title, e.name AS assignee,
           t.deadline::text AS deadline,
           EXTRACT(DAY FROM (NOW() - t.deadline))::int AS days_overdue
    FROM tasks t
    LEFT JOIN employees e ON t.assignee_id = e.id
    WHERE t.deleted_at IS NULL
      AND t.completed_at IS NULL
      AND t.deadline IS NOT NULL
      AND t.deadline < NOW()
      ${scope}
    ORDER BY t.deadline ASC
    LIMIT ${limit}
  `));
  const arr = ((rows as any).rows ?? rows) as any[];

  return JSON.stringify({
    count: arr.length,
    scope: ctx.role === "admin" ? "ทั้งหมด" : "ทีมของคุณ",
    tasks: arr.map((r: any) => ({
      display_id: r.display_id, title: r.title, assignee: r.assignee,
      deadline: r.deadline, days_overdue: r.days_overdue,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 6: get_team_workload — per-person task count for workload balancing
// ═══════════════════════════════════════════════════════════════════════════
async function execGetTeamWorkload(_args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const scope = teamScope(ctx);

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT
      e.name,
      COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.completed_at IS NULL)::int AS active_tasks,
      COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.deadline IS NOT NULL AND t.deadline < NOW() AND t.completed_at IS NULL)::int AS overdue,
      COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.completed_at IS NOT NULL
        AND (t.completed_at AT TIME ZONE 'Asia/Bangkok')::date = (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date)::int AS done_today,
      COALESCE(SUM(t.time_estimate_hours) FILTER (WHERE t.id IS NOT NULL)::numeric(6,1), 0) AS total_estimated_hours
    FROM employees e
    LEFT JOIN tasks t ON t.assignee_id = e.id AND t.deleted_at IS NULL
    WHERE e.is_active = true ${scope}
    GROUP BY e.id, e.name
    ORDER BY active_tasks DESC
  `));
  const arr = ((rows as any).rows ?? rows) as any[];

  return JSON.stringify({
    scope: ctx.role === "admin" ? "ทั้งหมด" : "ทีมของคุณ",
    members: arr.map((r: any) => ({
      name: r.name,
      active_tasks: Number(r.active_tasks ?? 0),
      overdue: Number(r.overdue ?? 0),
      done_today: Number(r.done_today ?? 0),
      estimated_hours: Number(r.total_estimated_hours ?? 0),
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 7: get_employee_leave — check leave/availability
// ═══════════════════════════════════════════════════════════════════════════
async function execGetEmployeeLeave(args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const employeeName = String(args.employee_name ?? "ฉัน");
  const emp = await resolveEmployee(employeeName, ctx);
  if (!emp) return JSON.stringify({ error: `ไม่พบพนักงาน "${employeeName}"` });

  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT lr.leave_type AS type, lr.start_date::text AS start_date, lr.end_date::text AS end_date,
           lr.status, lr.reason,
           lr.total_days AS days
    FROM leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    WHERE e.id = '${emp.id}'::uuid AND lr.status = 'approved'
      AND lr.end_date >= CURRENT_DATE
    ORDER BY lr.start_date LIMIT 10
  `));
  const leaves = ((rows as any).rows ?? rows) as any[];

  return JSON.stringify({
    employee: emp.name,
    upcoming_leaves: leaves.map((l: any) => ({
      type: l.type, start: l.start_date, end: l.end_date, days: l.days, reason: l.reason,
    })),
  has_upcoming_leave: leaves.length > 0,
});
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL 8: get_team_leave — list all upcoming leaves in scope
// ═══════════════════════════════════════════════════════════════════════════
async function execGetTeamLeave(_args: Record<string, unknown>, ctx: UserContext): Promise<string> {
  const scope = ctx.role === "admin" ? "" : ctx.role === "manager"
    ? `AND (e.id = '${ctx.userId}'::uuid OR e.manager_id = '${ctx.userId}'::uuid)`
    : `AND e.id = '${ctx.userId}'::uuid`;

  // Next 14 days
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT e.name, lr.leave_type AS type, lr.start_date::text, lr.end_date::text,
           lr.total_days AS days, lr.reason
    FROM leave_requests lr
    JOIN employees e ON lr.employee_id = e.id
    WHERE lr.status = 'approved'
      AND lr.start_date <= (CURRENT_DATE + INTERVAL '14 days')
      AND lr.end_date >= CURRENT_DATE
      ${scope}
    ORDER BY lr.start_date LIMIT 20
  `));
  const leaves = ((rows as any).rows ?? rows) as any[];

  return JSON.stringify({
    period: "14 days from today",
    count: leaves.length,
    leaves: leaves.map((l: any) => ({
      name: l.name, type: l.type, start: l.start_date, end: l.end_date, days: l.days, reason: l.reason,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool registry
// ═══════════════════════════════════════════════════════════════════════════

const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_my_summary",
      description: "สรุปสถานะงานของฉัน (คนที่กำลังถาม): จำนวนงานค้าง, เกินกำหนด, ครบวันนี้, ที่เสร็จวันนี้, ชม.ที่ log",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_employee_tasks",
      description: "ดูรายการงานของพนักงานคนใดคนหนึ่ง — กรองตามสถานะได้ (incomplete/overdue/done/due_today/all) พร้อม display_id, title, deadline, จำนวนวันที่เกินกำหนด",
      parameters: {
        type: "object",
        properties: {
          employee_name: { type: "string", description: "ชื่อพนักงาน (บางส่วนได้) หรือ 'ฉัน'/'me' สำหรับตัวเอง" },
          status:        { type: "string", description: "incomplete (ยังไม่เสร็จ) | overdue (เกินกำหนด) | done (เสร็จแล้ว) | due_today (ครบวันนี้) | all (ทั้งหมด)" },
          limit:         { type: "integer", description: "จำนวนผลลัพธ์สูงสุด (default 15)" },
        },
        required: ["employee_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_employee_stats",
      description: "ดูสถิติรวมของพนักงาน: จำนวนงานทั้งหมด/ที่ทำเสร็จ/ค้างอยู่/เกินกำหนด, on-time rate, ชม.ที่ log, ชม.ที่ประมาณการไว้ ในช่วงเวลาที่กำหนด",
      parameters: {
        type: "object",
        properties: {
          employee_name: { type: "string", description: "ชื่อพนักงาน หรือ 'ฉัน'/'me' สำหรับตัวเอง" },
          days:          { type: "integer", description: "ย้อนหลังกี่วัน (default 30, max 90)" },
        },
        required: ["employee_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tasks",
      description: "ค้นหางานจาก keyword ในชื่อเรื่อง — กรองตามชื่อพนักงานได้",
      parameters: {
        type: "object",
        properties: {
          query:         { type: "string", description: "คำค้นหาในชื่อเรื่องงาน" },
          assignee_name: { type: "string", description: "(optional) ชื่อพนักงานที่รับผิดชอบ" },
          limit:         { type: "integer", description: "จำนวนผลลัพธ์ (default 10, max 20)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_overdue",
      description: "รายการงานที่เกินกำหนดทั้งหมด (ยังไม่เสร็จ, เลย deadline) — เรียงตามวันที่เกินกำหนด",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "จำนวนผลลัพธ์สูงสุด (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_workload",
      description: "ดูภาระงานของทีม: แต่ละคนมีงานค้างกี่งาน, เกินกำหนดกี่งาน, ทำเสร็จวันนี้กี่งาน, ชม.ที่ประมาณการทั้งหมด",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_employee_leave",
      description: "ดูตารางวันลาของพนักงาน — ว่างวันไหน มีลาครั้งต่อไปเมื่อไหร่ ใช้วันไหน — ใช้เช็ค availability",
      parameters: {
        type: "object",
        properties: {
          employee_name: { type: "string", description: "ชื่อพนักงาน หรือ 'ฉัน'/'me' สำหรับตัวเอง" },
        },
        required: ["employee_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_leave",
      description: "ดูว่าในทีมมีใครลาบ้างในช่วง 14 วันข้างหน้า — เหมาะกับคำถาม 'อาทิตย์หน้าใครลา' หรือ 'มีใครหยุดบ้าง'",
      parameters: { type: "object", properties: {} },
    },
  },
];

const TOOL_EXECUTORS: Record<string, (args: Record<string, unknown>, ctx: UserContext) => Promise<string>> = {
  get_my_summary:      execGetMySummary,
  get_employee_tasks:  execGetEmployeeTasks,
  get_employee_stats:  execGetEmployeeStats,
  search_tasks:        execSearchTasks,
  list_overdue:        execListOverdue,
  get_team_workload:   execGetTeamWorkload,
  get_employee_leave:  execGetEmployeeLeave,
  get_team_leave:      execGetTeamLeave,
};

// ═══════════════════════════════════════════════════════════════════════════
// Q&A Pipeline
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `คุณคือเลขาใน Xiqma — user เห็นทุกคำที่คุณพิมพ์

⚠️ กฎข้อ 0 (สำคัญที่สุด): ห้ามพูดคิดในใจ ห้ามบอกว่าทำอะไรอยู่ ห้ามใช้คำว่า "ผู้ใช้ถาม" "ฉันจะ" "ก่อนอื่น" "มาดูกัน" — ตอบผลลัพธ์ตรงๆ เหมือนพิมพ์ข้อความหาเจ้านาย

กฎอื่น:
1. ตอบสั้น ตรงประเด็น เป็นภาษาไทย
2. เรียก tool ทันที — ไม่ต้องถามกลับ
3. ข้อมูลจาก tool เท่านั้น ห้ามเดา
4. ถ้า tool คืน list ว่าง → แปลว่าไม่มีสิ่งนั้น:
   - ไม่มี leave → "Jane ยังไม่มีการลาในช่วงนี้"
   - ไม่มี overdue → "ไม่มีงานเกินกำหนดเลย"
5. ถ้าถามว่า "ใคร" → เรียก tool ที่ให้รายชื่อ
   ถ้าถามว่า "กี่งาน" → เรียก tool ที่ให้ตัวเลข
   ถ้าถามว่า "อะไรค้าง" → get_employee_tasks status=incomplete
   ถ้าถามว่า "ทีม" → get_team_workload
   ถ้าถามว่า "ว่าง / ลา / leave / หยุด" → get_employee_leave
   ถ้าถามว่า "อาทิตย์หน้าใครลา" → get_team_leave
   ถ้าถามตัวเอง → 'ฉัน'
6. emoji, bullet list ถ้าข้อมูลเยอะ
7. งานเกินกำหนด = priority แรก`;

export interface QaResult {
  answer: string;
  model: string;
  toolCallsMade?: string[];
}

export const aiQaService = {
  async ask(question: string, user: UserContext): Promise<QaResult> {
    const MAX_ROUNDS = parseInt(process.env.AI_QA_MAX_ROUNDS ?? "3", 10);
    const contextNote = user.role === "admin"
      ? "ข้อมูลทั้งหมดในระบบ"
      : "ข้อมูลเฉพาะทีมของคุณ";

    const messages: ChatMessage[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\nผู้ใช้: ${user.name} (${user.role})\nขอบเขต: ${contextNote}\n\n💡 เรียก tool ได้หลายตัวพร้อมกันในการเรียกครั้งเดียว — ถ้าคำถามต้องการข้อมูลหลายอย่าง ให้เรียกทุกตัวที่จำเป็นเลย` },
      { role: "user", content: question },
    ];

    let finalText = "";
    let finalModel = "";
    const allToolsCalled: string[] = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const result = await chatComplete({
        messages,
        temperature: 0.2,
        maxTokens: 2000,
        tools: TOOLS,
        toolChoice: "auto",
      });

      finalModel = result.model;

      // No tool calls → this is the final answer
      if (!result.toolCalls?.length) {
        finalText = result.text || finalText || "ขออภัย ไม่สามารถตอบได้ในขณะนี้";
        break;
      }

      // Execute all tool calls in parallel
      const toolResults: ChatMessage[] = await Promise.all(
        result.toolCalls.map(async (tc) => {
          const executor = TOOL_EXECUTORS[tc.function.name];
          if (!executor) return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify({ error: `unknown tool: ${tc.function.name}` }) };

          allToolsCalled.push(tc.function.name);
          try {
            const args = JSON.parse(tc.function.arguments || "{}");
            const content = await executor(args, user);
            return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content };
          } catch (err: any) {
            logger.error({ err, tool: tc.function.name }, "qa tool execution failed");
            return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify({ error: err.message }) };
          }
        })
      );

      // Append assistant tool calls + tool results to conversation
      messages.push({ role: "assistant", content: result.text || "", tool_calls: result.toolCalls });
      messages.push(...toolResults);

      // If last round → force a final answer
      if (round === MAX_ROUNDS) {
        finalText = (await chatComplete({
          messages,
          temperature: 0.2,
          maxTokens: 800,
        })).text || "กรุณาถามใหม่ให้เจาะจงขึ้น";
      }
    }

    return {
      answer: finalText || "ขออภัย ไม่สามารถตอบได้ในขณะนี้",
      model: finalModel,
      toolCallsMade: allToolsCalled.length > 0 ? allToolsCalled : undefined,
    };
  },
};
