import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Daily Standup repository
//   - Aggregates "yesterday" + "today plan" data for an employee
//   - CRUD on daily_standups table
// All dates are computed in Asia/Bangkok timezone server-side.
// ─────────────────────────────────────────────────────────────────────────────

export interface StandupRow {
  id:          string;
  employeeId:  string;
  date:        string;        // YYYY-MM-DD
  draftText:   string;
  status:      "pending" | "sent" | "skipped";
  model:       string | null;
  generatedAt: string;
  sentAt:      string | null;
  editedAt:    string | null;
}

export interface StandupSettings {
  enabled:         boolean;
  sendTime:        string;        // "HH:MM:SS"
  sendDays:        number[];      // ISO weekday 1=Mon..7=Sun
  respectWorkDays: boolean;
}

export interface StandupContext {
  employee: {
    id: string;
    name: string;
    code: string | null;
  };
  yesterday: {
    date: string;
    completedTasks:  Array<{ displayId: string | null; title: string; statusName: string | null; minutes: number }>;
    inProgressTasks: Array<{ displayId: string | null; title: string; statusName: string | null }>;
    timeMinutes:     number;
    timeSessions:    number;
    commentsLeft:    number;
    incomingMentionsUnread: Array<{ taskTitle: string; displayId: string | null; from: string | null; snippet: string }>;
  };
  today: {
    date: string;
    plannedTasks: Array<{ displayId: string | null; title: string; statusName: string | null; deadline: string | null; priority: string }>;
    onLeave:      boolean;
  };
  blockers: {
    overdueCount:     number;
    waitingOnComment: Array<{ taskTitle: string; displayId: string | null; daysWaiting: number }>;
    pendingExtensions: number;
  };
}

export const standupRepository = {
  /** Build the data context that AI uses to write a standup. */
  async buildContext(employeeId: string): Promise<StandupContext> {
    // Use Asia/Bangkok dates
    const empRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.id, e.name, e.employee_code AS code
      FROM employees e WHERE e.id = '${employeeId}'::uuid LIMIT 1
    `));
    const empRow = (((empRows as any).rows ?? empRows) as any[])[0];
    if (!empRow) throw new Error("Employee not found");

    // Date helpers (run on DB so we use TZ-aware values)
    const dRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        (CURRENT_DATE AT TIME ZONE 'Asia/Bangkok')::date::text AS today_iso,
        ((CURRENT_DATE - INTERVAL '1 day') AT TIME ZONE 'Asia/Bangkok')::date::text AS yesterday_iso
    `));
    const d = (((dRows as any).rows ?? dRows) as any[])[0];
    const today_iso     = String(d.today_iso ?? "");
    const yesterday_iso = String(d.yesterday_iso ?? "");

    // 1) Tasks completed yesterday by this employee
    const completedRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.display_id, t.title,
        ls.name AS status_name,
        COALESCE(SUM(
          CASE
            WHEN s.ended_at IS NOT NULL AND s.duration_min IS NOT NULL THEN s.duration_min
            WHEN s.ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 60)::int
            ELSE 0
          END
        ), 0)::int AS minutes
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      LEFT JOIN task_time_sessions s
        ON s.task_id = t.id AND s.employee_id = t.assignee_id
        AND (s.started_at AT TIME ZONE 'Asia/Bangkok')::date = '${yesterday_iso}'
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND (t.completed_at AT TIME ZONE 'Asia/Bangkok')::date = '${yesterday_iso}'
      GROUP BY t.id, t.display_id, t.title, ls.name
      ORDER BY minutes DESC
      LIMIT 20
    `));
    const completedTasks = (((completedRows as any).rows ?? completedRows) as any[]).map((r) => ({
      displayId:  r.display_id ? String(r.display_id) : null,
      title:      String(r.title ?? ""),
      statusName: r.status_name ? String(r.status_name) : null,
      minutes:    Number(r.minutes ?? 0),
    }));

    // 2) Tasks in progress (not completed, plan_start <= today, owned by employee)
    const inProgressRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.display_id, t.title, ls.name AS status_name
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND t.completed_at IS NULL
        AND (t.plan_start IS NULL OR t.plan_start <= '${today_iso}'::date)
      ORDER BY t.priority DESC, t.deadline ASC NULLS LAST
      LIMIT 20
    `));
    const inProgressTasks = (((inProgressRows as any).rows ?? inProgressRows) as any[]).map((r) => ({
      displayId:  r.display_id ? String(r.display_id) : null,
      title:      String(r.title ?? ""),
      statusName: r.status_name ? String(r.status_name) : null,
    }));

    // 3) Time tracked yesterday
    const timeRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min
            WHEN ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int
            ELSE 0
          END
        ), 0)::int AS total_min,
        COUNT(*)::int AS sessions
      FROM task_time_sessions
      WHERE employee_id = '${employeeId}'::uuid
        AND (started_at AT TIME ZONE 'Asia/Bangkok')::date = '${yesterday_iso}'
    `));
    const timeAgg = (((timeRows as any).rows ?? timeRows) as any[])[0] ?? {};

    // 4) Comments left yesterday by this user
    const commentRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COUNT(*)::int AS n FROM task_comments
      WHERE author_id = '${employeeId}'::uuid
        AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = '${yesterday_iso}'
    `));
    const commentsLeft = Number(
      ((((commentRows as any).rows ?? commentRows) as any[])[0] ?? {}).n ?? 0
    );

    // 5) Tasks today's plan — same as inProgressTasks but with deadline + priority
    const todayRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.display_id, t.title, ls.name AS status_name,
             t.deadline::text AS deadline, t.priority::text AS priority
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
        AND t.completed_at IS NULL
        AND (t.plan_start IS NULL OR t.plan_start <= '${today_iso}'::date)
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
          WHEN 'normal' THEN 3 WHEN 'low' THEN 4
        END,
        t.deadline ASC NULLS LAST
      LIMIT 10
    `));
    const plannedTasks = (((todayRows as any).rows ?? todayRows) as any[]).map((r) => ({
      displayId:  r.display_id ? String(r.display_id) : null,
      title:      String(r.title ?? ""),
      statusName: r.status_name ? String(r.status_name) : null,
      deadline:   r.deadline ? String(r.deadline) : null,
      priority:   String(r.priority ?? "normal"),
    }));

    // 6) Overdue count
    const overdueRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COUNT(*)::int AS n FROM tasks
      WHERE assignee_id = '${employeeId}'::uuid
        AND deleted_at IS NULL
        AND completed_at IS NULL
        AND deadline IS NOT NULL AND deadline < NOW()
    `));
    const overdueCount = Number(((((overdueRows as any).rows ?? overdueRows) as any[])[0] ?? {}).n ?? 0);

    // 7) Pending extension requests by this user
    const extRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT COUNT(*)::int AS n FROM due_extension_requests
      WHERE requested_by = '${employeeId}'::uuid AND status = 'pending'
    `));
    const pendingExtensions = Number(((((extRows as any).rows ?? extRows) as any[])[0] ?? {}).n ?? 0);

    // 8) On leave today?
    let onLeave = false;
    try {
      const leaveRows = await db.execute<Record<string, unknown>>(sql.raw(`
        SELECT 1 FROM leave_requests
        WHERE employee_id = '${employeeId}'::uuid
          AND status = 'approved'
          AND start_date <= '${today_iso}'::date
          AND end_date   >= '${today_iso}'::date
        LIMIT 1
      `));
      const arr = (((leaveRows as any).rows ?? leaveRows) as any[]);
      onLeave = arr.length > 0;
    } catch { /* table may not exist */ }

    return {
      employee: {
        id:   String(empRow.id),
        name: String(empRow.name),
        code: empRow.code ? String(empRow.code) : null,
      },
      yesterday: {
        date:                   yesterday_iso,
        completedTasks,
        inProgressTasks,
        timeMinutes:            Number(timeAgg.total_min ?? 0),
        timeSessions:           Number(timeAgg.sessions ?? 0),
        commentsLeft,
        incomingMentionsUnread: [],
      },
      today: {
        date:         today_iso,
        plannedTasks,
        onLeave,
      },
      blockers: {
        overdueCount,
        waitingOnComment:  [],
        pendingExtensions,
      },
    };
  },

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  async findByEmployeeAndDate(employeeId: string, date: string): Promise<StandupRow | null> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        id::text, employee_id::text AS "employeeId",
        date::text, draft_text AS "draftText", status,
        model, generated_at AS "generatedAt", sent_at AS "sentAt", edited_at AS "editedAt"
      FROM daily_standups
      WHERE employee_id = '${employeeId}'::uuid AND date = '${date}'::date
      LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? rowToStandup(r) : null;
  },

  async upsert(params: {
    employeeId: string;
    date: string;
    draftText: string;
    model?: string | null;
  }): Promise<StandupRow> {
    const safe = params.draftText.replace(/'/g, "''");
    const model = params.model ? `'${params.model.replace(/'/g, "''")}'` : "NULL";
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO daily_standups (employee_id, date, draft_text, status, model, generated_at)
      VALUES ('${params.employeeId}'::uuid, '${params.date}'::date, '${safe}', 'pending', ${model}, NOW())
      ON CONFLICT (employee_id, date) DO UPDATE
        SET draft_text   = EXCLUDED.draft_text,
            model        = EXCLUDED.model,
            generated_at = NOW()
      RETURNING
        id::text, employee_id::text AS "employeeId",
        date::text, draft_text AS "draftText", status,
        model, generated_at AS "generatedAt", sent_at AS "sentAt", edited_at AS "editedAt"
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return rowToStandup(r);
  },

  async updateDraft(id: string, employeeId: string, draftText: string): Promise<StandupRow | null> {
    const safe = draftText.replace(/'/g, "''");
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE daily_standups
      SET draft_text = '${safe}', edited_at = NOW()
      WHERE id = '${id}'::uuid AND employee_id = '${employeeId}'::uuid
      RETURNING
        id::text, employee_id::text AS "employeeId",
        date::text, draft_text AS "draftText", status,
        model, generated_at AS "generatedAt", sent_at AS "sentAt", edited_at AS "editedAt"
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? rowToStandup(r) : null;
  },

  async setStatus(id: string, employeeId: string, status: "pending" | "sent" | "skipped"): Promise<StandupRow | null> {
    const sentAt = status === "sent" ? "NOW()" : "NULL";
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      UPDATE daily_standups
      SET status = '${status}', sent_at = ${sentAt}
      WHERE id = '${id}'::uuid AND employee_id = '${employeeId}'::uuid
      RETURNING
        id::text, employee_id::text AS "employeeId",
        date::text, draft_text AS "draftText", status,
        model, generated_at AS "generatedAt", sent_at AS "sentAt", edited_at AS "editedAt"
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? rowToStandup(r) : null;
  },

  async listEligibleEmployees(): Promise<Array<{ id: string; name: string }>> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.id::text, e.name FROM employees e
      WHERE e.is_active = true
      ORDER BY e.name
    `));
    return (((rows as any).rows ?? rows) as any[]).map((r) => ({
      id: String(r.id), name: String(r.name),
    }));
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  async getSettings(): Promise<StandupSettings> {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT enabled, send_time::text AS send_time, send_days, respect_work_days
      FROM standup_settings WHERE id = 1 LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    if (!r) {
      // auto-seed if missing
      await db.execute(sql.raw(`INSERT INTO standup_settings (id) VALUES (1) ON CONFLICT DO NOTHING`));
      return { enabled: true, sendTime: "08:00:00", sendDays: [1,2,3,4,5], respectWorkDays: true };
    }
    return {
      enabled:         !!r.enabled,
      sendTime:        String(r.send_time ?? "08:00:00"),
      sendDays:        Array.isArray(r.send_days) ? r.send_days.map((n: any) => Number(n)) : [1,2,3,4,5],
      respectWorkDays: !!r.respect_work_days,
    };
  },

  async updateSettings(s: Partial<StandupSettings>): Promise<StandupSettings> {
    const sets: string[] = ["updated_at = NOW()"];
    if (s.enabled !== undefined)         sets.push(`enabled = ${s.enabled}`);
    if (s.sendTime !== undefined)        sets.push(`send_time = '${s.sendTime}'::time`);
    if (s.sendDays !== undefined)        sets.push(`send_days = ARRAY[${s.sendDays.join(",")}]::integer[]`);
    if (s.respectWorkDays !== undefined) sets.push(`respect_work_days = ${s.respectWorkDays}`);
    await db.execute(sql.raw(`UPDATE standup_settings SET ${sets.join(", ")} WHERE id = 1`));
    return this.getSettings();
  },

  /** Get an employee's work_days (ISO weekday list) from their performance_config; null if not set. */
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

  async listForTeam(callerUserId: string, callerRole: string, date: string): Promise<StandupRow[]> {
    const scope =
      callerRole === "admin" ? "" :
      callerRole === "manager"
        ? `AND (e.manager_id = '${callerUserId}'::uuid OR e.id = '${callerUserId}'::uuid)`
        : `AND e.id = '${callerUserId}'::uuid`;
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        s.id::text, s.employee_id::text AS "employeeId",
        s.date::text, s.draft_text AS "draftText", s.status,
        s.model, s.generated_at AS "generatedAt", s.sent_at AS "sentAt", s.edited_at AS "editedAt",
        e.name AS "employeeName"
      FROM daily_standups s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.date = '${date}'::date ${scope}
      ORDER BY e.name
    `));
    return (((rows as any).rows ?? rows) as any[]).map((r) => ({
      ...rowToStandup(r),
      employeeName: r.employeeName ?? null,
    } as any));
  },
};

function rowToStandup(r: any): StandupRow {
  return {
    id:          String(r.id),
    employeeId:  String(r.employeeId),
    date:        String(r.date),
    draftText:   String(r.draftText ?? ""),
    status:      (r.status ?? "pending") as StandupRow["status"],
    model:       r.model ? String(r.model) : null,
    generatedAt: r.generatedAt ? new Date(r.generatedAt).toISOString() : "",
    sentAt:      r.sentAt ? new Date(r.sentAt).toISOString() : null,
    editedAt:    r.editedAt ? new Date(r.editedAt).toISOString() : null,
  };
}
