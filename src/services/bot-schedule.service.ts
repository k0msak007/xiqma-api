import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { botScheduleRepository, type BotSchedule } from "@/repositories/bot-schedule.repository.ts";
import { chatComplete, type ChatMessage } from "@/lib/openrouter.ts";
import { notificationDispatcher } from "@/lib/notification/dispatcher.ts";
import { logger } from "@/lib/logger.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Bot Schedule executor
//   - For each enabled schedule:
//     1. Decide if "now" matches send_time hour, send_days, send_day_of_month
//     2. Resolve audience (all / role / employee)
//     3. For each recipient → render templates with vars → optionally call AI
//     4. Dispatch notification (in_app / line / email per channels[])
//   - Dedupe via bot_schedule_runs (schedule_id, run_date, run_hour) UNIQUE
// ─────────────────────────────────────────────────────────────────────────────

interface ContextData {
  date:        string;       // YYYY-MM-DD (today, Bangkok)
  weekday:     string;
  employeeName: string;
  employeeCode: string | null;
  // numeric stats
  todayPlanned: number;
  todayCompleted: number;
  todayHours:   number;
  weekCompleted: number;
  weekHours:    number;
  overdue:      number;
  // morning_briefing — task lists
  overdueList:   string;
  dueTodayList:  string;
  dueSoonList:   string;
  // leave_reminder
  leaveToday:    string;
  leaveTomorrow: string;
  leaveThisWeek: string;
  leaveQuota:    string;
  pendingLeaves: string;
  leaveNone:     string;
  // time_reminder
  timeLogged:       string;
  timeMissing:      string;
  timeMissingCount: string;
  timeTotal:        string;
  // weekly_hours
  targetHours:       string;
  weekAssignedHours: string;
  weekLoggedHours:   string;
  hoursGap:          string;
  hoursOk:           string;
}

const WEEKDAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function fmtDeadline(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = MONTH_TH[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  if (hours === "00" && mins === "00") return `${day} ${month}`;
  if (hours === "23" && mins === "59") return `${day} ${month}`;
  return `${day} ${month} ${hours}:${mins}`;
}

function formatTaskList(rows: Array<{ display_id: string | null; title: string; deadline: string }>): string {
  if (!rows || rows.length === 0) return "";
  return rows.map((t) => {
    const id = t.display_id ? `[${t.display_id}] ` : "";
    const dl = t.deadline ? ` — กำหนด ${fmtDeadline(t.deadline)}` : "";
    return `${id}${t.title}${dl}`;
  }).join("\n");
}

function fmtDateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sd = s.getDate(), sm = MONTH_TH[s.getMonth()];
  const ed = e.getDate(), em = MONTH_TH[e.getMonth()];
  if (startIso.slice(0, 10) === endIso.slice(0, 10)) return `${sd} ${sm}`;
  if (sm === em) return `${sd}-${ed} ${sm}`;
  return `${sd} ${sm} - ${ed} ${em}`;
}

function formatLeaveList(rows: Array<{ name: string; type: string; start_date: string; end_date: string }>): string {
  if (!rows || rows.length === 0) return "";
  return rows.map((r) => {
    const leaveType = r.type === "sick" ? "ลาป่วย" : r.type === "vacation" ? "พักร้อน" : r.type === "annual" ? "ลาพักร้อน" : r.type;
    return `${r.name} (${leaveType} ${fmtDateRange(r.start_date, r.end_date)})`;
  }).join("\n");
}

async function buildEmployeeContext(employeeId: string, kind: BotSchedule["contextKind"]): Promise<ContextData> {
  // Bangkok-aware date helper
  const dRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT
      (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date::text AS today_iso,
      EXTRACT(DOW FROM (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok'))::int AS dow
  `));
  const d = (((dRows as any).rows ?? dRows) as any[])[0];
  const today_iso = String(d.today_iso ?? "");
  const dow       = Number(d.dow ?? 0);

  // Employee
  const empRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT name, employee_code AS code FROM employees WHERE id = '${employeeId}'::uuid LIMIT 1
  `));
  const emp = (((empRows as any).rows ?? empRows) as any[])[0] ?? {};

  const ctx: ContextData = {
    date:           today_iso,
    weekday:        WEEKDAY_TH[dow] ?? "",
    employeeName:   String(emp.name ?? ""),
    employeeCode:   emp.code ? String(emp.code) : null,
    todayPlanned:   0,
    todayCompleted: 0,
    todayHours:     0,
    weekCompleted:  0,
    weekHours:      0,
    overdue:        0,
    overdueList:    "",
    dueTodayList:   "",
    dueSoonList:    "",
    leaveToday:     "",
    leaveTomorrow:  "",
    leaveThisWeek:  "",
    leaveQuota:     "",
    pendingLeaves:  "",
    leaveNone:      "",
    timeLogged:       "",
    timeMissing:      "",
    timeMissingCount: "",
    timeTotal:        "",
    targetHours:       "",
    weekAssignedHours: "",
    weekLoggedHours:   "",
    hoursGap:          "",
    hoursOk:           "",
  };

  if (kind === "none") return ctx;

  // today/week stats — fetch only what's needed
  if (kind === "today" || kind === "yesterday") {
    const targetDate = kind === "yesterday"
      ? `((CURRENT_DATE - INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')::date::text`
      : `'${today_iso}'`;

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      WITH td AS (SELECT (${targetDate})::date AS d)
      SELECT
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id='${employeeId}'::uuid AND deleted_at IS NULL
                AND completed_at IS NULL AND (plan_start IS NULL OR plan_start <= (SELECT d FROM td))) AS planned,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id='${employeeId}'::uuid AND deleted_at IS NULL
                AND (completed_at AT TIME ZONE 'Asia/Bangkok')::date = (SELECT d FROM td)) AS completed,
        COALESCE((
          SELECT SUM(CASE WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min
                          WHEN ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))/60)::int
                          ELSE 0 END)::int
          FROM task_time_sessions
          WHERE employee_id='${employeeId}'::uuid
            AND (started_at AT TIME ZONE 'Asia/Bangkok')::date = (SELECT d FROM td)
        ), 0) AS minutes,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id='${employeeId}'::uuid AND deleted_at IS NULL
                AND completed_at IS NULL AND deadline IS NOT NULL AND deadline < NOW()) AS overdue
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0] ?? {};
    ctx.todayPlanned   = Number(r.planned ?? 0);
    ctx.todayCompleted = Number(r.completed ?? 0);
    ctx.todayHours     = Math.round(Number(r.minutes ?? 0) / 60 * 10) / 10;
    ctx.overdue        = Number(r.overdue ?? 0);
  } else if (kind === "week") {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id='${employeeId}'::uuid AND deleted_at IS NULL
                AND (completed_at AT TIME ZONE 'Asia/Bangkok')::date >= ((CURRENT_DATE - INTERVAL '6 days') AT TIME ZONE 'Asia/Bangkok')::date) AS completed,
        COALESCE((
          SELECT SUM(CASE WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min ELSE 0 END)::int
          FROM task_time_sessions
          WHERE employee_id='${employeeId}'::uuid
            AND (started_at AT TIME ZONE 'Asia/Bangkok')::date >= ((CURRENT_DATE - INTERVAL '6 days') AT TIME ZONE 'Asia/Bangkok')::date
        ), 0) AS minutes,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id='${employeeId}'::uuid AND deleted_at IS NULL
                AND completed_at IS NULL AND deadline IS NOT NULL AND deadline < NOW()) AS overdue
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0] ?? {};
    ctx.weekCompleted = Number(r.completed ?? 0);
    ctx.weekHours     = Math.round(Number(r.minutes ?? 0) / 60 * 10) / 10;
    ctx.overdue       = Number(r.overdue ?? 0);
  } else if (kind === "morning_briefing") {
    // ── Overdue (deadline < NOW, not completed) ──
    const overdueRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.display_id, t.title, t.deadline::text AS deadline
      FROM tasks t
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND t.completed_at IS NULL
        AND t.deadline IS NOT NULL
        AND t.deadline < NOW()
      ORDER BY t.deadline ASC
    `));
    const ov = ((overdueRows as any).rows ?? overdueRows) as Array<{ display_id: string | null; title: string; deadline: string }>;
    ctx.overdueList = formatTaskList(ov);
    ctx.overdue     = ov.length;

    // ── Due today (deadline between NOW and end of today Bangkok) ──
    const dueTodayRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.display_id, t.title, t.deadline::text AS deadline
      FROM tasks t
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND t.completed_at IS NULL
        AND t.deadline IS NOT NULL
        AND t.deadline >= NOW()
        AND t.deadline < ((CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')
      ORDER BY t.deadline ASC
    `));
    const dt = ((dueTodayRows as any).rows ?? dueTodayRows) as Array<{ display_id: string | null; title: string; deadline: string }>;
    ctx.dueTodayList = formatTaskList(dt);

    // ── Due in 3 days (tomorrow .. 3 days from now) ──
    const dueSoonRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.display_id, t.title, t.deadline::text AS deadline
      FROM tasks t
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND t.completed_at IS NULL
        AND t.deadline IS NOT NULL
        AND t.deadline >= ((CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')
        AND t.deadline < ((CURRENT_DATE + INTERVAL '4 days') AT TIME ZONE 'Asia/Bangkok')
      ORDER BY t.deadline ASC
    `));
    const ds = ((dueSoonRows as any).rows ?? dueSoonRows) as Array<{ display_id: string | null; title: string; deadline: string }>;
    ctx.dueSoonList = formatTaskList(ds);

    // Also populate todayPlanned (incomplete tasks due today or earlier)
    const plannedRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COUNT(*)::int AS c FROM tasks
      WHERE assignee_id = '${employeeId}'::uuid AND deleted_at IS NULL
        AND completed_at IS NULL
        AND (plan_start IS NULL OR plan_start <= (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok'))
    `));
    const pr = (((plannedRows as any).rows ?? plannedRows) as any[])[0] ?? {};
    ctx.todayPlanned = Number(pr.c ?? 0);
  } else if (kind === "leave_reminder") {
    // ── Leave today (company-wide) ──
    const todayRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.name, lr.leave_type AS type, lr.start_date::text, lr.end_date::text
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      WHERE lr.status = 'approved'
        AND lr.start_date <= (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')
        AND lr.end_date >= (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')
      ORDER BY lr.start_date
      LIMIT 20
    `));
    const today = ((todayRows as any).rows ?? todayRows) as Array<{ name: string; type: string; start_date: string; end_date: string }>;
    ctx.leaveToday = formatLeaveList(today);

    // ── Leave tomorrow (company-wide) ──
    const tomorrowRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.name, lr.leave_type AS type, lr.start_date::text, lr.end_date::text
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      WHERE lr.status = 'approved'
        AND lr.start_date = ((CURRENT_DATE + INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')::date
      ORDER BY lr.start_date
      LIMIT 20
    `));
    const tomorrow = ((tomorrowRows as any).rows ?? tomorrowRows) as Array<{ name: string; type: string; start_date: string; end_date: string }>;
    ctx.leaveTomorrow = formatLeaveList(tomorrow);

    // ── Leave in next 7 days (company-wide) ──
    const weekRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.name, lr.leave_type AS type, lr.start_date::text, lr.end_date::text
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      WHERE lr.status = 'approved'
        AND lr.start_date > (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')
        AND lr.start_date <= ((CURRENT_DATE + INTERVAL '7 days') AT TIME ZONE 'Asia/Bangkok')::date
      ORDER BY lr.start_date
      LIMIT 30
    `));
    const week = ((weekRows as any).rows ?? weekRows) as Array<{ name: string; type: string; start_date: string; end_date: string }>;
    ctx.leaveThisWeek = formatLeaveList(week);

    // ── Leave quota (per employee) ──
    const quotaRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT type, COALESCE(remaining_days, total_days)::int AS remaining
      FROM leave_quotas
      WHERE employee_id = '${employeeId}'::uuid AND year = EXTRACT(YEAR FROM CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::int
      ORDER BY type
    `));
    const quotas = ((quotaRows as any).rows ?? quotaRows) as Array<{ type: string; remaining: number }>;
    if (quotas.length > 0) {
      ctx.leaveQuota = quotas.map((q) => {
        const label = q.type === "annual" ? "พักร้อน" : q.type === "sick" ? "ป่วย" : q.type === "vacation" ? "พักร้อน" : q.type;
        return `${label}: ${q.remaining} วัน`;
      }).join(", ");
    }

    // ── Pending leaves (if this employee is a manager) ──
    const pendingRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.name, lr.leave_type AS type, lr.start_date::text, lr.end_date::text
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      WHERE lr.status = 'pending'
        AND e.manager_id = '${employeeId}'::uuid
      ORDER BY lr.start_date
      LIMIT 10
    `));
    const pending = ((pendingRows as any).rows ?? pendingRows) as Array<{ name: string; type: string; start_date: string; end_date: string }>;
    ctx.pendingLeaves = formatLeaveList(pending);

    if (!ctx.leaveToday && !ctx.leaveTomorrow && !ctx.leaveThisWeek) {
      ctx.leaveNone = "ไม่มีใครลาในช่วงนี้";
    }
  } else if (kind === "time_reminder") {
    // ── Time tracking today ──
    const timeRows = await db.execute<Record<string, unknown>>(sql.raw(`
      WITH today_sessions AS (
        SELECT
          COALESCE(SUM(CASE WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min
                            WHEN ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))/60)::int
                            ELSE 0 END), 0)::int AS minutes,
          COUNT(*)::int AS session_count
        FROM task_time_sessions
        WHERE employee_id = '${employeeId}'::uuid
          AND (started_at AT TIME ZONE 'Asia/Bangkok')::date = (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date
      )
      SELECT minutes, session_count FROM today_sessions
    `));
    const tr = (((timeRows as any).rows ?? timeRows) as any[])[0] ?? {};
    const minutes = Number(tr.minutes ?? 0);
    if (minutes > 0) {
      const hours = Math.round(minutes / 60 * 10) / 10;
      ctx.timeLogged = `✅ คุณ log แล้ว ${hours} ชม.`;
      ctx.timeMissing = "";
    } else {
      ctx.timeLogged = "";
      ctx.timeMissing = "⚠️ คุณยังไม่ได้ log time วันนี้";
    }
  } else if (kind === "weekly_hours") {
    // ── Target hours from employee_performance_config JOIN work_schedules ──
    const cfgRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COALESCE(ws.hours_per_week * epc.expected_ratio, 32)::numeric(6,1) AS target
      FROM employee_performance_config epc
      JOIN work_schedules ws ON epc.work_schedule_id = ws.id
      WHERE epc.employee_id = '${employeeId}'::uuid
      LIMIT 1
    `));
    const cfg = (((cfgRows as any).rows ?? cfgRows) as any[])[0];
    const target = cfg ? Number(cfg.target) : 32;
    ctx.targetHours = String(Math.round(target * 10) / 10);

    // ── Assigned hours (estimated_minutes of incomplete tasks this week) ──
    // Fallback: if no estimated_minutes → assume 240 min (4 hrs) per task
    const assignedRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COALESCE(
        SUM(CASE
          WHEN t.time_estimate_hours IS NOT NULL AND t.time_estimate_hours > 0 THEN t.time_estimate_hours
          ELSE 4
        END), 0
      )::numeric(6,1) AS assigned
      FROM tasks t
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND t.completed_at IS NULL
    `));
    const ar = (((assignedRows as any).rows ?? assignedRows) as any[])[0] ?? {};
    const assigned = Number(ar.assigned ?? 0);
    ctx.weekAssignedHours = String(Math.round(assigned * 10) / 10);

    // ── Logged hours (time sessions this week) ──
    const logRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COALESCE(
        SUM(CASE WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min
                 WHEN ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))/60)::int
                 ELSE 0 END) / 60.0, 0
      )::numeric(6,1) AS logged
      FROM task_time_sessions
      WHERE employee_id = '${employeeId}'::uuid
        AND (started_at AT TIME ZONE 'Asia/Bangkok')::date
            >= ((CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::int + 1) AT TIME ZONE 'Asia/Bangkok')::date
    `));
    const lr = (((logRows as any).rows ?? logRows) as any[])[0] ?? {};
    const logged = Number(lr.logged ?? 0);
    ctx.weekLoggedHours = String(Math.round(logged * 10) / 10);

    // ── Derived vars ──
    const gap = target - assigned;
    if (gap > 0) {
      ctx.hoursGap = String(Math.round(gap * 10) / 10);
      ctx.hoursOk = "";
    } else {
      ctx.hoursGap = "";
      ctx.hoursOk = "✅ ครบชั่วโมงแล้ว";
    }
  }

  return ctx;
}

function renderTemplate(template: string, ctx: ContextData): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/g,           ctx.employeeName)
    .replace(/\{\{\s*code\s*\}\}/g,           ctx.employeeCode ?? "")
    .replace(/\{\{\s*date\s*\}\}/g,           ctx.date)
    .replace(/\{\{\s*weekday\s*\}\}/g,        ctx.weekday)
    .replace(/\{\{\s*todayPlanned\s*\}\}/g,   String(ctx.todayPlanned))
    .replace(/\{\{\s*todayCompleted\s*\}\}/g, String(ctx.todayCompleted))
    .replace(/\{\{\s*todayHours\s*\}\}/g,     String(ctx.todayHours))
    .replace(/\{\{\s*weekCompleted\s*\}\}/g,  String(ctx.weekCompleted))
    .replace(/\{\{\s*weekHours\s*\}\}/g,      String(ctx.weekHours))
    .replace(/\{\{\s*overdue\s*\}\}/g,        String(ctx.overdue))
    .replace(/\{\{\s*overdueList\s*\}\}/g,    ctx.overdueList)
    .replace(/\{\{\s*dueTodayList\s*\}\}/g,   ctx.dueTodayList)
    .replace(/\{\{\s*dueSoonList\s*\}\}/g,    ctx.dueSoonList)
    .replace(/\{\{\s*leaveToday\s*\}\}/g,     ctx.leaveToday)
    .replace(/\{\{\s*leaveTomorrow\s*\}\}/g,  ctx.leaveTomorrow)
    .replace(/\{\{\s*leaveThisWeek\s*\}\}/g,  ctx.leaveThisWeek)
    .replace(/\{\{\s*leaveQuota\s*\}\}/g,     ctx.leaveQuota)
    .replace(/\{\{\s*pendingLeaves\s*\}\}/g,  ctx.pendingLeaves)
    .replace(/\{\{\s*leaveNone\s*\}\}/g,      ctx.leaveNone)
    .replace(/\{\{\s*timeLogged\s*\}\}/g,     ctx.timeLogged)
    .replace(/\{\{\s*timeMissing\s*\}\}/g,    ctx.timeMissing)
    .replace(/\{\{\s*targetHours\s*\}\}/g,       ctx.targetHours)
    .replace(/\{\{\s*weekAssignedHours\s*\}\}/g, ctx.weekAssignedHours)
    .replace(/\{\{\s*weekLoggedHours\s*\}\}/g,   ctx.weekLoggedHours)
    .replace(/\{\{\s*hoursGap\s*\}\}/g,          ctx.hoursGap)
    .replace(/\{\{\s*hoursOk\s*\}\}/g,           ctx.hoursOk);
}

async function generateAiBody(prompt: string, ctx: ContextData): Promise<string> {
  const contextLines: string[] = [
    `- ชื่อ: ${ctx.employeeName}`,
    `- วันที่: ${ctx.date} (${ctx.weekday})`,
  ];
  if (ctx.todayPlanned > 0) contextLines.push(`- งานที่ค้างวันนี้: ${ctx.todayPlanned}`);
  if (ctx.todayCompleted > 0) contextLines.push(`- งานที่ปิดวันนี้: ${ctx.todayCompleted}`);
  if (ctx.todayHours > 0) contextLines.push(`- เวลาวันนี้: ${ctx.todayHours} ชม.`);
  if (ctx.weekCompleted > 0) contextLines.push(`- งานปิดสัปดาห์นี้: ${ctx.weekCompleted}`);
  if (ctx.weekHours > 0) contextLines.push(`- เวลาสัปดาห์นี้: ${ctx.weekHours} ชม.`);
  if (ctx.overdue > 0) contextLines.push(`- เกินกำหนด: ${ctx.overdue}`);
  if (ctx.overdueList) contextLines.push(`\n🔴 เกินกำหนด:\n${ctx.overdueList}`);
  if (ctx.dueTodayList) contextLines.push(`\n⚠️ กำหนดวันนี้:\n${ctx.dueTodayList}`);
  if (ctx.dueSoonList) contextLines.push(`\n📅 ใกล้ครบ 3 วัน:\n${ctx.dueSoonList}`);
  if (ctx.leaveToday) contextLines.push(`\n🏖️ ลาวันนี้:\n${ctx.leaveToday}`);
  if (ctx.leaveTomorrow) contextLines.push(`\n📅 ลาพรุ่งนี้:\n${ctx.leaveTomorrow}`);
  if (ctx.leaveThisWeek) contextLines.push(`\n📅 ลาใน 7 วัน:\n${ctx.leaveThisWeek}`);
  if (ctx.leaveQuota) contextLines.push(`\nวันลาคงเหลือ: ${ctx.leaveQuota}`);
  if (ctx.pendingLeaves) contextLines.push(`\n⏳ รออนุมัติลา:\n${ctx.pendingLeaves}`);
  if (ctx.leaveNone) contextLines.push(`\n${ctx.leaveNone}`);
  if (ctx.timeLogged) contextLines.push(`\n${ctx.timeLogged}`);
  if (ctx.timeMissing) contextLines.push(`\n${ctx.timeMissing}`);
  if (ctx.targetHours) contextLines.push(`\nเป้าหมายสัปดาห์: ${ctx.targetHours} ชม.`);
  if (ctx.weekAssignedHours) contextLines.push(`ได้รับงานแล้ว: ${ctx.weekAssignedHours} ชม.`);
  if (ctx.weekLoggedHours) contextLines.push(`log แล้ว: ${ctx.weekLoggedHours} ชม.`);
  if (ctx.hoursGap) contextLines.push(`⚠️ ขาดอีก: ${ctx.hoursGap} ชม.`);
  if (ctx.hoursOk) contextLines.push(ctx.hoursOk);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "คุณเป็น bot ผู้ช่วยที่เขียนข้อความสั้น ๆ (2-4 ประโยค) ให้พนักงาน ภาษาไทย กระชับ ใช้ข้อมูลจริง ไม่ต้องเดา ตอบเป็น text ปกติ ห้าม markdown ห้าม code block",
    },
    {
      role: "user",
      content: `${prompt}

ข้อมูลพนักงาน:
${contextLines.join("\n")}`,
    },
  ];
  const ai = await chatComplete({ messages, temperature: 0.5, maxTokens: 600 });
  return ai.text.trim();
}

export const botScheduleService = {
  list:    () => botScheduleRepository.list(),
  findById: (id: string) => botScheduleRepository.findById(id),

  async create(input: any, createdBy: string) {
    return botScheduleRepository.create(input, createdBy);
  },

  async update(id: string, input: any) {
    const updated = await botScheduleRepository.update(id, input);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ schedule", 404);
    return updated;
  },

  async remove(id: string) {
    await botScheduleRepository.remove(id);
  },

  /**
   * Run a single schedule for its audience.
   * @param force  bypass time/day check (used by "Run now" button)
   */
  async runSchedule(s: BotSchedule, opts?: { force?: boolean }): Promise<{ recipients: number; failed: number }> {
    const audience = await botScheduleRepository.resolveAudience(s);
    let success = 0;
    let failed  = 0;

    for (const employeeId of audience) {
      try {
        // Per-employee work_days check
        if (s.respectWorkDays && !opts?.force) {
          const wd = await botScheduleRepository.getEmployeeWorkDays(employeeId);
          if (wd) {
            const bkk = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
            const isoDow = bkk.getDay() === 0 ? 7 : bkk.getDay();
            if (!wd.includes(isoDow)) continue;
          }
        }

        const ctx = await buildEmployeeContext(employeeId, s.contextKind);
        const title = renderTemplate(s.titleTemplate, ctx) || s.name;
        let body: string;
        if (s.mode === "ai") {
          const renderedPrompt = renderTemplate(s.bodyTemplate, ctx);
          body = await generateAiBody(renderedPrompt, ctx);
        } else {
          body = renderTemplate(s.bodyTemplate, ctx);
        }

        // Build allowed channel set from this schedule
        const allowedChannels = new Set(s.channels);

        await notificationDispatcher.fanOut({
          type:        s.notifType as any,
          recipients:  [employeeId],
          title,
          body,
          relatedType: null,
          relatedId:   null,
          deepLink:    s.deepLink ?? null,
          // Hint: dispatcher still respects user prefs — schedule.channels is
          // an ADDITIONAL gate beyond user prefs (only push to these channels).
          channelOverride: Array.from(allowedChannels) as any,
        } as any);

        success++;
      } catch (err) {
        logger.error({ err, scheduleId: s.id, employeeId }, "bot_schedule.runSchedule item failed");
        failed++;
      }
    }
    return { recipients: success, failed };
  },

  /**
   * Cron tick: every minute. For each FIXED schedule, decide if it should run now.
   */
  async tickFixed(): Promise<{ ran: number; total: number }> {
    if ((this as any)._tickFixedRunning) return { ran: 0, total: 0 };
    (this as any)._tickFixedRunning = true;
    try {
    const all = await botScheduleRepository.listByType("fixed");

    const bkk    = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const curHour = bkk.getHours();
    const curMin  = bkk.getMinutes();
    const isoDow  = bkk.getDay() === 0 ? 7 : bkk.getDay();
    const dom     = bkk.getDate();
    const dateIso = bkk.toISOString().slice(0, 10);

    let ran = 0;
    for (const s of all) {
      const [sendH, sendM] = (s.sendTime ?? "08:00").split(":").map(Number);
      if (sendH !== curHour) continue;
      if (sendM !== curMin) continue;
      if (!s.sendDays.includes(isoDow)) continue;
      if (s.sendDayOfMonth != null && s.sendDayOfMonth !== dom) continue;

      const already = await botScheduleRepository.hasRunThisHour(s.id, dateIso, curHour);
      if (already) continue;

      try {
        const result = await this.runSchedule(s);
        await botScheduleRepository.logRun(s.id, dateIso, curHour, result.recipients, result.failed);
        ran++;
        logger.info({ scheduleId: s.id, name: s.name, ...result }, "bot_schedule.tickFixed ran");
      } catch (err) {
        logger.error({ err, scheduleId: s.id }, "bot_schedule.tickFixed failed");
      }
    }
    return { ran, total: all.length };
    } finally { (this as any)._tickFixedRunning = false; }
  },

  /**
   * Cron tick: every minute. For each INTERVAL schedule within its time window.
   * Lightweight — 99% of ticks return immediately after condition checks.
   */
  async tickInterval(): Promise<{ ran: number; total: number }> {
    if ((this as any)._tickIntervalRunning) return { ran: 0, total: 0 };
    (this as any)._tickIntervalRunning = true;
    try {
    const all = await botScheduleRepository.listByType("interval");
    if (all.length === 0) return { ran: 0, total: 0 };

    const bkk     = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const curHour = bkk.getHours();
    const curMin  = bkk.getMinutes();
    const isoDow  = bkk.getDay() === 0 ? 7 : bkk.getDay();
    const dateIso = bkk.toISOString().slice(0, 10);

    let ran = 0;
    for (const s of all) {
      // Day check
      if (!s.sendDays.includes(isoDow)) continue;

      // Window check
      if (s.sendWindowStart && s.sendWindowEnd) {
        const nowMinutes = curHour * 60 + curMin;
        const [sh, sm] = (s.sendWindowStart ?? "09:00").split(":").map(Number);
        const [eh, em] = (s.sendWindowEnd ?? "18:00").split(":").map(Number);
        const startMin = (sh ?? 0) * 60 + (sm ?? 0);
        const endMin   = (eh ?? 0) * 60 + (em ?? 0);
        if (nowMinutes < startMin || nowMinutes >= endMin) continue;

        // Interval check: is this minute aligned with the schedule?
        const minutesFromStart = nowMinutes - startMin;
        const interval = s.sendIntervalMinutes ?? 60;
        if (minutesFromStart % interval !== 0) continue;
      }

      // Dedupe per-minute
      const already = await botScheduleRepository.hasRunThisMinute(s.id, dateIso, curHour, curMin);
      if (already) continue;

      try {
        const result = await this.runSchedule(s);
        await botScheduleRepository.logRunMinute(s.id, dateIso, curHour, curMin, result.recipients, result.failed);
        ran++;
        logger.info({ scheduleId: s.id, name: s.name, ...result }, "bot_schedule.tickInterval ran");
      } catch (err) {
        logger.error({ err, scheduleId: s.id }, "bot_schedule.tickInterval failed");
      }
    }
    return { ran, total: all.length };
    } finally { (this as any)._tickIntervalRunning = false; }
  },
};
