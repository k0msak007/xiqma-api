import cron from "node-cron";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { logger } from "@/lib/logger.ts";
import { emitNotification } from "./dispatcher.ts";
import { standupService } from "@/services/standup.service.ts";
import { botScheduleService } from "@/services/bot-schedule.service.ts";

// Audit-style audience: assignee + their manager + all admins (deduped).
async function audience(taskId: string, baseAssignee: string): Promise<string[]> {
  const ids = new Set<string>([baseAssignee]);
  try {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.manager_id::text AS manager_id FROM employees e
      WHERE e.id = '${baseAssignee}'::uuid LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    if (r?.manager_id) ids.add(String(r.manager_id));
  } catch {}
  try {
    const adminRows = await db.execute<{ id: string }>(sql.raw(`
      SELECT e.id::text AS id FROM employees e
      LEFT JOIN roles r ON e.role_id = r.id
      WHERE e.is_active = true AND r.name = 'admin'
    `));
    for (const a of ((adminRows as any).rows ?? adminRows) as Array<{ id: string }>) {
      ids.add(String(a.id));
    }
  } catch {}
  return Array.from(ids);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification cron jobs
//   • task_due_soon — every hour: deadline ∈ (NOW, NOW + 24h] AND not completed.
//                     Dedupe: skip tasks that already sent due_reminder in last 18h.
//   • task_overdue  — every hour: deadline < NOW AND not completed.
//                     Dedupe: send once per task (until completed → reopened cycle).
// ─────────────────────────────────────────────────────────────────────────────

interface DueRow {
  id:         string;
  title:      string;
  display_id: string | null;
  assignee_id: string;
  deadline:   string;
}

async function runDueSoonJob(): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.id::text, t.title, t.display_id,
           t.assignee_id::text, t.deadline::text
    FROM tasks t
    WHERE t.deleted_at IS NULL
      AND t.completed_at IS NULL
      AND t.assignee_id IS NOT NULL
      AND t.deadline IS NOT NULL
      AND t.deadline > NOW()
      AND t.deadline <= NOW() + INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM notification_logs n
        WHERE n.task_id = t.id
          AND n.notif_type = 'due_reminder'
          AND n.created_at > NOW() - INTERVAL '18 hours'
      )
  `));
  const arr = ((rows as any).rows ?? rows) as DueRow[];
  if (arr.length === 0) return;

  for (const t of arr) {
    const hoursLeft = Math.max(
      1,
      Math.round((new Date(t.deadline).getTime() - Date.now()) / 3600_000),
    );
    const recipients = await audience(t.id, t.assignee_id);
    emitNotification({
      type:        "due_reminder",
      recipients,
      title:       t.display_id
        ? `ใกล้กำหนด [${t.display_id}] (${hoursLeft} ชม.)`
        : `ใกล้กำหนด: ${t.title} (${hoursLeft} ชม.)`,
      body:        t.title,
      relatedType: "task",
      relatedId:   t.id,
      taskId:      t.id,
      deepLink:    `/task/${t.id}`,
    });
  }
  logger.info({ count: arr.length }, "cron.due_reminder dispatched");
}

async function runOverdueJob(): Promise<void> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.id::text, t.title, t.display_id,
           t.assignee_id::text, t.deadline::text
    FROM tasks t
    WHERE t.deleted_at IS NULL
      AND t.completed_at IS NULL
      AND t.assignee_id IS NOT NULL
      AND t.deadline IS NOT NULL
      AND t.deadline < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM notification_logs n
        WHERE n.task_id = t.id
          AND n.notif_type = 'overdue'
      )
  `));
  const arr = ((rows as any).rows ?? rows) as DueRow[];
  if (arr.length === 0) return;

  for (const t of arr) {
    const recipients = await audience(t.id, t.assignee_id);
    emitNotification({
      type:        "overdue",
      recipients,
      title:       t.display_id ? `🔴 เกินกำหนด [${t.display_id}]` : `🔴 เกินกำหนด: ${t.title}`,
      body:        t.title,
      relatedType: "task",
      relatedId:   t.id,
      taskId:      t.id,
      deepLink:    `/task/${t.id}`,
    });
  }
  logger.info({ count: arr.length }, "cron.overdue dispatched");
}

let started = false;

// Standup tick — runs every hour at :00. Reads settings each run, generates only
// if current Bangkok hour matches settings.send_time hour AND today is in send_days.
async function runStandupTick(): Promise<void> {
  try {
    const settings = await (await import("@/repositories/standup.repository.ts")).standupRepository.getSettings();
    if (!settings.enabled) return;

    // Current Bangkok hour
    const bkk = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const curHour = bkk.getHours();
    const sendHour = Number(settings.sendTime.split(":")[0] ?? "8");
    if (curHour !== sendHour) return;

    const result = await standupService.generateForAll();
    logger.info(result, "cron.daily_standup completed");
  } catch (err) {
    logger.error({ err }, "cron.daily_standup failed");
  }
}

export function startNotificationCron(): void {
  if (started) return;
  started = true;

  // ทุกต้นชั่วโมง (00 นาที) — due reminder + overdue
  cron.schedule("0 * * * *", () => {
    runDueSoonJob().catch((err) => logger.error({ err }, "cron.due_reminder failed"));
    runOverdueJob().catch((err) => logger.error({ err }, "cron.overdue failed"));
  });

  // ทุกต้นชั่วโมง — เช็ค standup settings แล้วตัดสินใจรันหรือไม่
  // (admin เปลี่ยน "เวลาส่ง" → มีผลในชั่วโมงถัดไป โดยไม่ต้อง re-deploy)
  cron.schedule("0 * * * *", () => {
    runStandupTick().catch((err) => logger.error({ err }, "cron.daily_standup tick failed"));
  }, { timezone: "Asia/Bangkok" });

  // ทุกต้นชั่วโมง — เช็ค bot schedules แบบ fixed (admin-defined recurring messages)
  cron.schedule("0 * * * *", () => {
    botScheduleService.tickFixed()
      .then((r) => logger.info(r, "cron.bot_schedules.tickFixed completed"))
      .catch((err) => logger.error({ err }, "cron.bot_schedules.tickFixed failed"));
  }, { timezone: "Asia/Bangkok" });

  // ทุกนาที — เช็ค bot schedules แบบ interval (within time window)
  cron.schedule("* * * * *", () => {
    botScheduleService.tickInterval()
      .catch((err) => logger.error({ err }, "cron.bot_schedules.tickInterval failed"));
  }, { timezone: "Asia/Bangkok" });

  // ── Recurring task generation ───────────────────────────────────────────
  // Daily at midnight Bangkok — create copies of recurring tasks due today.
  async function runRecurringTasksJob(): Promise<void> {
    const now = new Date(new Date().toLocaleString("en-US", { timezone: "Asia/Bangkok" }));
    const today = now.toISOString().slice(0, 10);
    const isoDow = now.getDay() === 0 ? 7 : now.getDay();

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.id::text, t.title, t.description, t.list_id::text, t.assignee_id::text,
             t.task_type_id::text, t.priority, t.time_estimate_hours::text,
             t.story_points::text, t.list_status_id::text,
             t.recurrence_rule, t.recurrence_interval, t.recurrence_days
      FROM tasks t
      WHERE t.deleted_at IS NULL AND t.is_recurring = true
        AND t.recurrence_rule IS NOT NULL
        AND (t.recurrence_end_date IS NULL OR t.recurrence_end_date >= '${today}'::date)
        AND NOT EXISTS (
          SELECT 1 FROM tasks child
          WHERE child.recurrence_parent_id = t.id
            AND (child.created_at AT TIME ZONE 'Asia/Bangkok')::date = '${today}'::date
        )
    `));
    const tasks = ((rows as any).rows ?? rows) as any[];

    let created = 0;
    for (const t of tasks) {
      let shouldCreate = false;
      if (t.recurrence_rule === "daily") {
        shouldCreate = true;
      } else if (t.recurrence_rule === "weekly") {
        const days = Array.isArray(t.recurrence_days) ? t.recurrence_days.map(Number) : [];
        shouldCreate = days.length === 0 || days.includes(isoDow);
      } else if (t.recurrence_rule === "monthly") {
        const dom = now.getDate();
        shouldCreate = dom === (t.original_day ?? dom);
      }
      if (!shouldCreate) continue;

      try {
        await db.execute(sql.raw(`
          INSERT INTO tasks (title, description, list_id, assignee_id, task_type_id,
            priority, time_estimate_hours, story_points, list_status_id,
            recurrence_parent_id, display_id)
          VALUES (
            '${(t.title || "").replace(/'/g, "''")}',
            ${t.description ? `'${t.description.replace(/'/g, "''")}'` : "NULL"},
            '${t.list_id}'::uuid,
            ${t.assignee_id ? `'${t.assignee_id}'::uuid` : "NULL"},
            ${t.task_type_id ? `'${t.task_type_id}'::uuid` : "NULL"},
            ${t.priority ? `'${t.priority}'` : "NULL"},
            ${t.time_estimate_hours ?? "NULL"},
            ${t.story_points ?? "NULL"},
            ${t.list_status_id ? `'${t.list_status_id}'::uuid` : "NULL"},
            '${t.id}'::uuid,
            (SELECT 'TK-' || LPAD(nextval('tasks_display_seq')::text, 6, '0'))
          )
        `));
        created++;
      } catch (err) {
        logger.error({ err, taskId: t.id }, "recurring task creation failed");
      }
    }
    if (created > 0) logger.info({ created }, "cron.recurring_tasks completed");
  }

  cron.schedule("0 0 * * *", () => {
    runRecurringTasksJob().catch((err) => logger.error({ err }, "cron.recurring_tasks failed"));
  }, { timezone: "Asia/Bangkok" });

  // ทุก 30 นาที — ล้าง LINE conversation history เก่า (keep last 30 per user)
  cron.schedule("*/30 * * * *", async () => {
    try {
      const result = await db.execute<Record<string, unknown>>(sql.raw(`
        DELETE FROM line_messages
        WHERE id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY line_user_id ORDER BY created_at DESC) AS rn
            FROM line_messages
          ) sub WHERE rn <= 30
        )
      `));
      const deleted = ((result as any).rowCount ?? 0);
      if (deleted > 0) logger.info({ deleted }, "cron.line_messages cleanup");
    } catch (err) {
      logger.error({ err }, "cron.line_messages cleanup failed");
    }
  });

  // Run once on startup (for testing convenience)
  if (process.env.NODE_ENV === "development") {
    setTimeout(() => {
      runDueSoonJob().catch((err) => logger.error({ err }, "cron.due_reminder boot failed"));
      runOverdueJob().catch((err) => logger.error({ err }, "cron.overdue boot failed"));
      // standup boot generation skipped intentionally — too expensive to run on every restart
    }, 5000);
  }

  logger.info({}, "notification cron started (hourly + daily 8am)");
}
