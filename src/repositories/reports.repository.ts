import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { buildManagerScopeClause } from "./_scope.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Reports repository — aggregated stats per employee for a date window.
// All numbers come from a single multi-CTE query for efficiency.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmployeeReportData {
  employee: {
    id: string;
    name: string;
    code: string | null;
    avatarUrl: string | null;
    role: string | null;
    workSchedule: string | null;
  };
  range: { from: string; to: string };
  tasks: {
    total: number;
    completed: number;
    overdue: number;            // tasks with deadline < to AND not completed
    inProgress: number;
    cancelled: number;
    onTimeRate: number;         // 0..100 (% of completed that finished on time)
    completedLate: number;
    avgLateDays: number;
    reworkTotal: number;
    storyPointsCompleted: number;
  };
  time: {
    totalMinutes: number;
    sessions: number;
    perDay: Array<{ day: string; minutes: number }>;
  };
  topTasks: Array<{
    id: string;
    displayId: string | null;
    title: string;
    statusName: string | null;
    statusColor: string | null;
    completedAt: string | null;
    deadline: string | null;
    durationMin: number;
    reworkCount: number;
  }>;
}

export const reportsRepository = {
  async employeeReport(employeeId: string, from: string, to: string): Promise<EmployeeReportData> {
    // Employee profile
    const empRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT e.id, e.name, e.employee_code AS code, e.avatar_url AS avatar_url,
             r.name AS role_name,
             ws.name AS work_schedule_name
      FROM employees e
      LEFT JOIN roles r ON e.role_id = r.id
      LEFT JOIN employee_performance_config pc ON pc.employee_id = e.id
      LEFT JOIN work_schedules ws ON pc.work_schedule_id = ws.id
      WHERE e.id = '${employeeId}'::uuid
      LIMIT 1
    `));
    const empRow = (empRows as any)[0] ?? (empRows as any).rows?.[0];
    if (!empRow) throw new Error("Employee not found");

    // Aggregate task stats
    const aggRows = await db.execute<Record<string, unknown>>(sql.raw(`
      WITH t AS (
        SELECT t.*, ls.type AS status_type
        FROM tasks t
        LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
        WHERE t.assignee_id = '${employeeId}'::uuid
          AND t.deleted_at IS NULL
          AND (
            (t.completed_at IS NOT NULL
              AND t.completed_at::date BETWEEN '${from}' AND '${to}')
            OR
            (t.completed_at IS NULL
              AND t.created_at::date BETWEEN '${from}' AND '${to}')
          )
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_type::text IN ('done','completed','closed'))::int AS completed,
        COUNT(*) FILTER (WHERE status_type::text = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status_type::text IN ('in_progress','review'))::int AS in_progress,
        COUNT(*) FILTER (
          WHERE deadline IS NOT NULL
            AND deadline < NOW()
            AND completed_at IS NULL
        )::int AS overdue,
        COUNT(*) FILTER (
          WHERE completed_at IS NOT NULL
            AND deadline IS NOT NULL
            AND completed_at > deadline
        )::int AS completed_late,
        COALESCE(AVG(
          CASE
            WHEN completed_at IS NOT NULL AND deadline IS NOT NULL AND completed_at > deadline
            THEN EXTRACT(EPOCH FROM (completed_at - deadline)) / 86400
            ELSE NULL
          END
        ), 0)::numeric(10,2) AS avg_late_days,
        COALESCE(SUM(rework_count), 0)::int AS rework_total,
        COALESCE(SUM(story_points) FILTER (WHERE status_type::text IN ('done','completed','closed')), 0)::int AS sp_completed
      FROM t
    `));
    const agg = ((aggRows as any)[0] ?? (aggRows as any).rows?.[0]) ?? {};

    const completed     = Number(agg.completed ?? 0);
    const completedLate = Number(agg.completed_late ?? 0);
    const onTimeRate    = completed > 0
      ? Math.round(((completed - completedLate) / completed) * 100)
      : 0;

    // Time tracking
    const timeRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min
            WHEN ended_at IS NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int
            ELSE 0
          END
        ), 0)::int AS total_minutes,
        COUNT(*)::int AS sessions
      FROM task_time_sessions
      WHERE employee_id = '${employeeId}'::uuid
        AND started_at::date BETWEEN '${from}' AND '${to}'
    `));
    const timeAgg = ((timeRows as any)[0] ?? (timeRows as any).rows?.[0]) ?? {};

    const perDayRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        (started_at AT TIME ZONE 'Asia/Bangkok')::date::text AS day,
        COALESCE(SUM(
          CASE
            WHEN ended_at IS NOT NULL AND duration_min IS NOT NULL THEN duration_min
            WHEN ended_at IS NULL
              THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int
            ELSE 0
          END
        ), 0)::int AS minutes
      FROM task_time_sessions
      WHERE employee_id = '${employeeId}'::uuid
        AND started_at::date BETWEEN '${from}' AND '${to}'
      GROUP BY day
      ORDER BY day
    `));

    // Top tasks (most time spent in window)
    const topRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        t.id, t.display_id, t.title,
        ls.name AS status_name, ls.color AS status_color,
        t.completed_at, t.deadline, t.rework_count,
        COALESCE(SUM(
          CASE
            WHEN s.ended_at IS NOT NULL AND s.duration_min IS NOT NULL THEN s.duration_min
            WHEN s.ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 60)::int
            ELSE 0
          END
        ), 0)::int AS duration_min
      FROM tasks t
      LEFT JOIN list_statuses ls ON t.list_status_id = ls.id
      LEFT JOIN task_time_sessions s
        ON s.task_id = t.id
        AND s.employee_id = '${employeeId}'::uuid
        AND s.started_at::date BETWEEN '${from}' AND '${to}'
      WHERE t.assignee_id = '${employeeId}'::uuid
        AND t.deleted_at IS NULL
      GROUP BY t.id, ls.name, ls.color
      HAVING COALESCE(SUM(
          CASE
            WHEN s.ended_at IS NOT NULL AND s.duration_min IS NOT NULL THEN s.duration_min
            WHEN s.ended_at IS NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 60)::int
            ELSE 0
          END
        ), 0) > 0
      ORDER BY duration_min DESC
      LIMIT 10
    `));

    const rows = (perDayRows as any).rows ?? perDayRows;
    const topRowsArr = (topRows as any).rows ?? topRows;

    return {
      employee: {
        id:           empRow.id,
        name:         empRow.name,
        code:         empRow.code ?? null,
        avatarUrl:    empRow.avatar_url ?? null,
        role:         empRow.role_name ?? null,
        workSchedule: empRow.work_schedule_name ?? null,
      },
      range: { from, to },
      tasks: {
        total:                Number(agg.total ?? 0),
        completed,
        overdue:              Number(agg.overdue ?? 0),
        inProgress:           Number(agg.in_progress ?? 0),
        cancelled:            Number(agg.cancelled ?? 0),
        onTimeRate,
        completedLate,
        avgLateDays:          Number(agg.avg_late_days ?? 0),
        reworkTotal:          Number(agg.rework_total ?? 0),
        storyPointsCompleted: Number(agg.sp_completed ?? 0),
      },
      time: {
        totalMinutes: Number(timeAgg.total_minutes ?? 0),
        sessions:     Number(timeAgg.sessions ?? 0),
        perDay:       (rows as any[]).map((r) => ({ day: String(r.day), minutes: Number(r.minutes) })),
      },
      topTasks: (topRowsArr as any[]).map((r) => ({
        id:           String(r.id),
        displayId:    r.display_id ? String(r.display_id) : null,
        title:        String(r.title ?? ""),
        statusName:   r.status_name ? String(r.status_name) : null,
        statusColor:  r.status_color ? String(r.status_color) : null,
        completedAt:  r.completed_at ? new Date(r.completed_at).toISOString() : null,
        deadline:     r.deadline ? new Date(r.deadline).toISOString() : null,
        durationMin:  Number(r.duration_min ?? 0),
        reworkCount:  Number(r.rework_count ?? 0),
      })),
    };
  },

  // ── AI summary cache ────────────────────────────────────────────────────────
  async findCachedSummary(scopeType: string, scopeId: string, from: string, to: string, language: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT * FROM report_summaries
      WHERE scope_type = '${scopeType}'
        AND scope_id = '${scopeId}'::uuid
        AND date_from = '${from}'
        AND date_to = '${to}'
        AND language = '${language}'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `));
    const arr = (rows as any).rows ?? rows;
    return (arr as any[])[0] ?? null;
  },

  async saveSummary(params: {
    scopeType: string; scopeId: string; from: string; to: string;
    language: string; model: string; summaryText: string; dataHash?: string;
  }) {
    await db.execute(sql.raw(`
      INSERT INTO report_summaries
        (scope_type, scope_id, date_from, date_to, language, model, summary_text, data_hash)
      VALUES
        ('${params.scopeType}', '${params.scopeId}'::uuid, '${params.from}', '${params.to}',
         '${params.language}', '${params.model.replace(/'/g, "''")}',
         '${params.summaryText.replace(/'/g, "''")}',
         ${params.dataHash ? `'${params.dataHash}'` : "NULL"})
    `));
  },

  async invalidateSummary(scopeType: string, scopeId: string, from: string, to: string) {
    await db.execute(sql.raw(`
      DELETE FROM report_summaries
      WHERE scope_type = '${scopeType}'
        AND scope_id = '${scopeId}'::uuid
        AND date_from = '${from}'
        AND date_to = '${to}'
    `));
  },

  // ── Team report (admin/manager) ─────────────────────────────────────────────
  /**
   * List employee IDs in scope for team report:
   *   - admin: all active employees
   *   - manager: direct reports + self
   */
  async listTeamMemberIds(callerUserId: string, callerRole: string): Promise<string[]> {
    const scope = buildManagerScopeClause(callerRole, callerUserId, "e.id");
    const includeSelf =
      callerRole === "manager" ? `OR e.id = '${callerUserId}'::uuid` : "";
    const rows = await db.execute<{ id: string }>(sql.raw(`
      SELECT e.id::text AS id FROM employees e
      WHERE e.is_active = true
        AND (1=1 ${scope} ${includeSelf})
      ORDER BY e.name ASC
    `));
    const arr = (rows as any).rows ?? rows;
    return (arr as any[]).map((r) => String(r.id));
  },

  async getTeamReports(
    callerUserId: string,
    callerRole: string,
    from: string,
    to: string,
  ): Promise<EmployeeReportData[]> {
    const ids = await this.listTeamMemberIds(callerUserId, callerRole);
    const reports = await Promise.all(ids.map((id) => this.employeeReport(id, from, to)));
    return reports;
  },
};
