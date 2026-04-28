import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Bot Schedules — CRUD + helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface BotSchedule {
  id:                string;
  name:              string;
  description:       string | null;
  enabled:           boolean;
  sendTime:          string;            // "HH:MM:SS"
  sendDays:          number[];
  sendDayOfMonth:    number | null;
  audienceType:      "all" | "role" | "employee";
  audienceValue:     string | null;
  respectWorkDays:   boolean;
  mode:              "static" | "ai";
  titleTemplate:     string;
  bodyTemplate:      string;
  contextKind:       "today" | "yesterday" | "week" | "none";
  channels:          string[];
  notifType:         string;
  deepLink:          string | null;
  createdAt:         string;
  updatedAt:         string;
}

function rowToSchedule(r: any): BotSchedule {
  return {
    id:               String(r.id),
    name:             String(r.name ?? ""),
    description:      r.description ? String(r.description) : null,
    enabled:          !!r.enabled,
    sendTime:         String(r.send_time ?? "08:00:00"),
    sendDays:         Array.isArray(r.send_days) ? r.send_days.map((n: any) => Number(n)) : [],
    sendDayOfMonth:   r.send_day_of_month != null ? Number(r.send_day_of_month) : null,
    audienceType:     (r.audience_type ?? "all") as BotSchedule["audienceType"],
    audienceValue:    r.audience_value ? String(r.audience_value) : null,
    respectWorkDays:  !!r.respect_work_days,
    mode:             (r.mode ?? "ai") as BotSchedule["mode"],
    titleTemplate:    String(r.title_template ?? ""),
    bodyTemplate:     String(r.body_template ?? ""),
    contextKind:      (r.context_kind ?? "today") as BotSchedule["contextKind"],
    channels:         Array.isArray(r.channels) ? r.channels.map((c: any) => String(c)) : [],
    notifType:        String(r.notif_type ?? "daily_summary"),
    deepLink:         r.deep_link ? String(r.deep_link) : null,
    createdAt:        r.created_at ? new Date(r.created_at).toISOString() : "",
    updatedAt:        r.updated_at ? new Date(r.updated_at).toISOString() : "",
  };
}

const COLS = `
  id, name, description, enabled,
  send_time::text AS send_time,
  send_days, send_day_of_month,
  audience_type, audience_value, respect_work_days,
  mode, title_template, body_template, context_kind,
  channels, notif_type, deep_link,
  created_at, updated_at
`;

export const botScheduleRepository = {
  async list(): Promise<BotSchedule[]> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT ${COLS} FROM bot_schedules ORDER BY created_at DESC
    `));
    const arr = ((rows as any).rows ?? rows) as any[];
    return arr.map(rowToSchedule);
  },

  async listEnabled(): Promise<BotSchedule[]> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT ${COLS} FROM bot_schedules WHERE enabled = true ORDER BY created_at
    `));
    const arr = ((rows as any).rows ?? rows) as any[];
    return arr.map(rowToSchedule);
  },

  async findById(id: string): Promise<BotSchedule | null> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT ${COLS} FROM bot_schedules WHERE id = '${id}'::uuid LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? rowToSchedule(r) : null;
  },

  async create(input: Partial<BotSchedule> & { name: string; titleTemplate: string; bodyTemplate: string }, createdBy?: string): Promise<BotSchedule> {
    const cols: string[] = ["name", "title_template", "body_template"];
    const vals: string[] = [
      `'${input.name.replace(/'/g, "''")}'`,
      `'${input.titleTemplate.replace(/'/g, "''")}'`,
      `'${input.bodyTemplate.replace(/'/g, "''")}'`,
    ];
    if (input.description !== undefined) {
      cols.push("description");
      vals.push(input.description ? `'${input.description.replace(/'/g, "''")}'` : "NULL");
    }
    if (input.enabled !== undefined)         { cols.push("enabled");         vals.push(`${input.enabled}`); }
    if (input.sendTime !== undefined)        { cols.push("send_time");       vals.push(`'${input.sendTime}'::time`); }
    if (input.sendDays !== undefined)        { cols.push("send_days");       vals.push(`ARRAY[${input.sendDays.join(",")}]::integer[]`); }
    if (input.sendDayOfMonth !== undefined && input.sendDayOfMonth != null) {
      cols.push("send_day_of_month"); vals.push(`${input.sendDayOfMonth}`);
    }
    if (input.audienceType !== undefined)    { cols.push("audience_type");   vals.push(`'${input.audienceType}'`); }
    if (input.audienceValue !== undefined)   { cols.push("audience_value");  vals.push(input.audienceValue ? `'${input.audienceValue.replace(/'/g, "''")}'` : "NULL"); }
    if (input.respectWorkDays !== undefined) { cols.push("respect_work_days"); vals.push(`${input.respectWorkDays}`); }
    if (input.mode !== undefined)            { cols.push("mode");            vals.push(`'${input.mode}'`); }
    if (input.contextKind !== undefined)     { cols.push("context_kind");    vals.push(`'${input.contextKind}'`); }
    if (input.channels !== undefined)        { cols.push("channels");        vals.push(`ARRAY[${input.channels.map((c) => `'${c}'`).join(",")}]::text[]`); }
    if (input.notifType !== undefined)       { cols.push("notif_type");      vals.push(`'${input.notifType}'`); }
    if (input.deepLink !== undefined)        { cols.push("deep_link");       vals.push(input.deepLink ? `'${input.deepLink.replace(/'/g, "''")}'` : "NULL"); }
    if (createdBy)                           { cols.push("created_by");      vals.push(`'${createdBy}'::uuid`); }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO bot_schedules (${cols.join(", ")}) VALUES (${vals.join(", ")})
      RETURNING ${COLS}
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return rowToSchedule(r);
  },

  async update(id: string, input: Partial<BotSchedule>): Promise<BotSchedule | null> {
    const sets: string[] = ["updated_at = NOW()"];
    if (input.name !== undefined)            sets.push(`name = '${input.name.replace(/'/g, "''")}'`);
    if (input.description !== undefined)     sets.push(input.description ? `description = '${input.description.replace(/'/g, "''")}'` : "description = NULL");
    if (input.enabled !== undefined)         sets.push(`enabled = ${input.enabled}`);
    if (input.sendTime !== undefined)        sets.push(`send_time = '${input.sendTime}'::time`);
    if (input.sendDays !== undefined)        sets.push(`send_days = ARRAY[${input.sendDays.join(",")}]::integer[]`);
    if (input.sendDayOfMonth !== undefined)  sets.push(input.sendDayOfMonth != null ? `send_day_of_month = ${input.sendDayOfMonth}` : "send_day_of_month = NULL");
    if (input.audienceType !== undefined)    sets.push(`audience_type = '${input.audienceType}'`);
    if (input.audienceValue !== undefined)   sets.push(input.audienceValue ? `audience_value = '${input.audienceValue.replace(/'/g, "''")}'` : "audience_value = NULL");
    if (input.respectWorkDays !== undefined) sets.push(`respect_work_days = ${input.respectWorkDays}`);
    if (input.mode !== undefined)            sets.push(`mode = '${input.mode}'`);
    if (input.titleTemplate !== undefined)   sets.push(`title_template = '${input.titleTemplate.replace(/'/g, "''")}'`);
    if (input.bodyTemplate !== undefined)    sets.push(`body_template = '${input.bodyTemplate.replace(/'/g, "''")}'`);
    if (input.contextKind !== undefined)     sets.push(`context_kind = '${input.contextKind}'`);
    if (input.channels !== undefined)        sets.push(`channels = ARRAY[${input.channels.map((c) => `'${c}'`).join(",")}]::text[]`);
    if (input.notifType !== undefined)       sets.push(`notif_type = '${input.notifType}'`);
    if (input.deepLink !== undefined)        sets.push(input.deepLink ? `deep_link = '${input.deepLink.replace(/'/g, "''")}'` : "deep_link = NULL");

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE bot_schedules SET ${sets.join(", ")} WHERE id = '${id}'::uuid
      RETURNING ${COLS}
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? rowToSchedule(r) : null;
  },

  async remove(id: string): Promise<void> {
    await db.execute(sql.raw(`DELETE FROM bot_schedules WHERE id = '${id}'::uuid`));
  },

  // ── Audience resolution ────────────────────────────────────────────────────
  async resolveAudience(s: BotSchedule): Promise<string[]> {
    if (s.audienceType === "employee" && s.audienceValue) {
      const rows = await db.execute<{ id: string }>(sql.raw(`
        SELECT id::text FROM employees WHERE id = '${s.audienceValue}'::uuid AND is_active = true
      `));
      return (((rows as any).rows ?? rows) as any[]).map((r) => String(r.id));
    }
    if (s.audienceType === "role" && s.audienceValue) {
      const rows = await db.execute<{ id: string }>(sql.raw(`
        SELECT e.id::text FROM employees e
        LEFT JOIN roles r ON e.role_id = r.id
        WHERE e.is_active = true AND r.name = '${s.audienceValue.replace(/'/g, "''")}'
      `));
      return (((rows as any).rows ?? rows) as any[]).map((r) => String(r.id));
    }
    // 'all'
    const rows = await db.execute<{ id: string }>(sql.raw(`
      SELECT id::text FROM employees WHERE is_active = true
    `));
    return (((rows as any).rows ?? rows) as any[]).map((r) => String(r.id));
  },

  async getEmployeeWorkDays(employeeId: string): Promise<number[] | null> {
    try {
      const rows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT work_days FROM employee_performance_config
        WHERE employee_id = '${employeeId}'::uuid LIMIT 1
      `));
      const r = (((rows as any).rows ?? rows) as any[])[0];
      if (!r || !Array.isArray(r.work_days) || r.work_days.length === 0) return null;
      return r.work_days.map((n: any) => Number(n));
    } catch {
      return null;
    }
  },

  // ── Run log dedupe ─────────────────────────────────────────────────────────
  async hasRunThisHour(scheduleId: string, dateIso: string, hour: number): Promise<boolean> {
    const rows = await db.execute<{ id: string }>(sql.raw(`
      SELECT id FROM bot_schedule_runs
      WHERE schedule_id = '${scheduleId}'::uuid
        AND run_date = '${dateIso}'::date
        AND run_hour = ${hour}
      LIMIT 1
    `));
    const arr = (((rows as any).rows ?? rows) as any[]);
    return arr.length > 0;
  },

  async logRun(scheduleId: string, dateIso: string, hour: number, recipients: number, failed: number): Promise<void> {
    await db.execute(sql.raw(`
      INSERT INTO bot_schedule_runs (schedule_id, run_date, run_hour, recipients, failed)
      VALUES ('${scheduleId}'::uuid, '${dateIso}'::date, ${hour}, ${recipients}, ${failed})
      ON CONFLICT (schedule_id, run_date, run_hour) DO NOTHING
    `));
  },
};
