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
}

const WEEKDAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

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
    .replace(/\{\{\s*overdue\s*\}\}/g,        String(ctx.overdue));
}

async function generateAiBody(prompt: string, ctx: ContextData): Promise<string> {
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
- ชื่อ: ${ctx.employeeName}
- วันที่: ${ctx.date} (${ctx.weekday})
- งานที่ค้างวันนี้: ${ctx.todayPlanned}
- งานที่ปิดวันนี้: ${ctx.todayCompleted}
- เวลาวันนี้: ${ctx.todayHours} ชม.
- งานปิดสัปดาห์นี้: ${ctx.weekCompleted}
- เวลาสัปดาห์นี้: ${ctx.weekHours} ชม.
- เกินกำหนด: ${ctx.overdue}`,
    },
  ];
  const ai = await chatComplete({ messages, temperature: 0.5, maxTokens: 400 });
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
   * Cron tick: every hour. For each enabled schedule, decide if it should run now.
   */
  async tick(): Promise<{ ran: number; total: number }> {
    const all = await botScheduleRepository.listEnabled();

    // Now in Asia/Bangkok
    const bkk    = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const curHour = bkk.getHours();
    const isoDow  = bkk.getDay() === 0 ? 7 : bkk.getDay();
    const dom     = bkk.getDate();
    const dateIso = bkk.toISOString().slice(0, 10);

    let ran = 0;
    for (const s of all) {
      // Time match
      const sendHour = Number(s.sendTime.split(":")[0] ?? "8");
      if (sendHour !== curHour) continue;
      if (!s.sendDays.includes(isoDow)) continue;
      if (s.sendDayOfMonth != null && s.sendDayOfMonth !== dom) continue;

      // Dedupe
      const already = await botScheduleRepository.hasRunThisHour(s.id, dateIso, curHour);
      if (already) continue;

      try {
        const result = await this.runSchedule(s);
        await botScheduleRepository.logRun(s.id, dateIso, curHour, result.recipients, result.failed);
        ran++;
        logger.info({ scheduleId: s.id, name: s.name, ...result }, "bot_schedule.tick ran");
      } catch (err) {
        logger.error({ err, scheduleId: s.id }, "bot_schedule.tick failed");
      }
    }
    return { ran, total: all.length };
  },
};
