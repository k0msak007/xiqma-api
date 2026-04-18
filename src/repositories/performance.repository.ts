import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import type {
  CreatePerformanceConfigInput,
  AnalyticsPerformanceQuery,
  VelocityQuery,
  EfficiencyQuery,
  WeeklyReportQuery,
  GenerateWeeklyReportInput,
  MonthlyHrReportQuery,
} from "@/validators/performance.validator.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** แปลง Date เป็น YYYY-MM-DD string */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** คืน ISO week start (จันทร์) จาก date string หรือ Date object */
function getWeekStart(d?: string | Date): string {
  const dt = d ? new Date(d) : new Date();
  const day = dt.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(dt);
  monday.setDate(dt.getDate() + diff);
  return toDateStr(monday);
}

/** คืน date range จาก period */
function getPeriodRange(period: string): { start: string; end: string } {
  const now = new Date();
  const end = toDateStr(now);
  switch (period) {
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      return { start: toDateStr(start), end };
    }
    case "quarter": {
      const start = new Date(now);
      start.setMonth(now.getMonth() - 3);
      return { start: toDateStr(start), end };
    }
    case "year": {
      const start = new Date(now);
      start.setFullYear(now.getFullYear() - 1);
      return { start: toDateStr(start), end };
    }
    default: { // month
      const start = new Date(now);
      start.setMonth(now.getMonth() - 1);
      return { start: toDateStr(start), end };
    }
  }
}

// ── Performance Config ─────────────────────────────────────────────────────────

export const performanceConfigRepository = {
  async findByEmployee(employeeId: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        pc.id,
        pc.employee_id,
        e.name            AS employee_name,
        e.employee_code,
        pc.work_schedule_id,
        ws.name           AS work_schedule_name,
        ws.days_per_week,
        ws.hours_per_day,
        ws.hours_per_week,
        ws.work_start_time,
        ws.work_end_time,
        pc.expected_ratio,
        pc.pointed_work_percent,
        pc.non_pointed_work_percent,
        pc.point_target,
        pc.point_period,
        pc.effective_from,
        pc.created_at,
        pc.updated_at
      FROM employee_performance_config pc
      JOIN employees  e  ON e.id  = pc.employee_id
      JOIN work_schedules ws ON ws.id = pc.work_schedule_id
      WHERE pc.employee_id = '${employeeId}'::uuid
      LIMIT 1
    `));
    return rows[0] ?? null;
  },

  async upsert(data: CreatePerformanceConfigInput) {
    const {
      employee_id,
      work_schedule_id,
      expected_ratio,
      pointed_work_percent,
      point_target,
      point_period,
      effective_from,
    } = data;

    const effectiveFromVal = effective_from ?? new Date().toISOString().split("T")[0];
    const pointTargetClause = point_target != null ? `${point_target}` : "NULL";

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO employee_performance_config
        (employee_id, work_schedule_id, expected_ratio, pointed_work_percent,
         point_target, point_period, effective_from)
      VALUES
        ('${employee_id}'::uuid, '${work_schedule_id}'::uuid,
         ${expected_ratio}, ${pointed_work_percent},
         ${pointTargetClause}, '${point_period}', '${effectiveFromVal}')
      ON CONFLICT (employee_id) DO UPDATE SET
        work_schedule_id      = EXCLUDED.work_schedule_id,
        expected_ratio        = EXCLUDED.expected_ratio,
        pointed_work_percent  = EXCLUDED.pointed_work_percent,
        point_target          = EXCLUDED.point_target,
        point_period          = EXCLUDED.point_period,
        effective_from        = EXCLUDED.effective_from,
        updated_at            = NOW()
      RETURNING *
    `));
    return rows[0];
  },
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analyticsRepository = {
  /** รวม task stats ของ employee หรือทีม */
  async getPerformanceSummary(params: AnalyticsPerformanceQuery & { userId: string; userRole: string }) {
    const { userId, userRole, employee_id, period, start, end } = params;

    // กำหนด date range
    let rangeStart: string;
    let rangeEnd: string;
    if (start && end) {
      rangeStart = start;
      rangeEnd = end;
    } else {
      const r = getPeriodRange(period ?? "month");
      rangeStart = r.start;
      rangeEnd = r.end;
    }

    // กำหนด employee filter
    let empCondition: string;
    if (userRole === "employee") {
      empCondition = `t.assignee_id = '${userId}'::uuid`;
    } else if (employee_id) {
      empCondition = `t.assignee_id = '${employee_id}'::uuid`;
    } else {
      empCondition = "TRUE"; // admin/manager เห็นทุกคน
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE ls.type != 'cancelled') AS total_tasks,
        COUNT(*) FILTER (WHERE ls.type IN ('completed', 'done')) AS completed_tasks,
        COUNT(*) FILTER (WHERE ls.type IN ('in_progress', 'pending', 'paused', 'review', 'blocked', 'open')) AS active_tasks,
        COUNT(*) FILTER (WHERE ls.type = 'cancelled' OR ls.type = 'closed') AS cancelled_tasks,
        COUNT(*) FILTER (WHERE t.deadline < NOW() AND ls.type NOT IN ('completed', 'done', 'cancelled', 'closed')) AS overdue_tasks,
        COALESCE(SUM(t.story_points) FILTER (WHERE ls.type IN ('completed', 'done')), 0) AS completed_points,
        COALESCE(SUM(t.story_points) FILTER (WHERE ls.type NOT IN ('completed', 'done', 'cancelled', 'closed')), 0) AS assigned_points,
        COALESCE(SUM(t.actual_hours) FILTER (WHERE ls.type IN ('completed', 'done')), 0) AS total_actual_hours,
        COALESCE(SUM(t.time_estimate_hours) FILTER (WHERE ls.type IN ('completed', 'done')), 0) AS total_estimate_hours,
        COALESCE(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 3600.0) FILTER (WHERE ls.type IN ('completed', 'done') AND t.started_at IS NOT NULL), 0) AS avg_completion_hours,
        ROUND(
          COUNT(*) FILTER (WHERE ls.type IN ('completed', 'done'))::numeric 
          / NULLIF(COUNT(*) FILTER (WHERE ls.type NOT IN ('cancelled', 'closed')), 0) * 100, 2
        ) AS completion_rate
      FROM tasks t
      JOIN list_statuses ls ON t.list_status_id = ls.id
      WHERE t.deleted_at IS NULL
        AND ${empCondition}
        AND t.created_at::date BETWEEN '${rangeStart}'::date AND '${rangeEnd}'::date
    `));

    return {
      period: { start: rangeStart, end: rangeEnd },
      employee_id: userRole === "employee" ? userId : (employee_id ?? null),
      ...rows[0],
    };
  },

  /** velocity ย้อนหลัง N สัปดาห์ จาก weekly_reports */
  async getVelocity(params: VelocityQuery & { userId: string; userRole: string }) {
    const { userId, userRole, employee_id, weeks } = params;

    const weeksNum = weeks ?? 8;

    let empCondition: string;
    if (userRole === "employee") {
      empCondition = `wr.employee_id = '${userId}'::uuid`;
    } else if (employee_id) {
      empCondition = `wr.employee_id = '${employee_id}'::uuid`;
    } else {
      empCondition = "TRUE";
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        wr.id,
        wr.employee_id,
        e.name           AS employee_name,
        e.employee_code,
        wr.week_start,
        (wr.week_start::date + interval '6 days')::date AS week_end,
        wr.tasks_done,
        wr.tasks_overdue,
        wr.total_manday,
        wr.actual_hours,
        wr.expected_points,
        wr.actual_points,
        wr.performance_ratio,
        wr.performance_label,
        wr.avg_score,
        wr.rank,
        wr.prev_week_score
      FROM weekly_reports wr
      JOIN employees e ON e.id = wr.employee_id
      WHERE ${empCondition}
        AND wr.week_start >= (CURRENT_DATE - (${weeksNum} * 7 || ' days')::interval)::date
      ORDER BY wr.week_start ASC, e.name ASC
    `));

    return rows;
  },

  /** วิเคราะห์ความแม่นยำในการ estimate ของแต่ละคน */
  async getEfficiency(params: EfficiencyQuery & { userId: string; userRole: string }) {
    const { userId, userRole, period, employee_id } = params;
    const { start, end } = getPeriodRange(period ?? "month");

    let empCondition = "TRUE";
    if (userRole === "employee") {
      empCondition = `t.assignee_id = '${userId}'::uuid`;
    } else if (employee_id) {
      empCondition = `t.assignee_id = '${employee_id}'::uuid`;
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        e.id             AS employee_id,
        e.name           AS employee_name,
        e.employee_code,
        e.avatar_url,
        e.department,
        COUNT(*)                                                         AS total_tasks,
        ROUND(AVG(t.time_estimate_hours)::numeric, 2)                   AS avg_estimate_hours,
        ROUND(AVG(t.actual_hours)::numeric, 2)                          AS avg_actual_hours,
        ROUND(AVG(
          CASE WHEN t.time_estimate_hours > 0
            THEN (t.actual_hours / t.time_estimate_hours * 100.0)
            ELSE NULL
          END
        )::numeric, 2)                                                   AS accuracy_pct,
        ROUND(
          SUM(t.actual_hours)::numeric
          / NULLIF(SUM(t.time_estimate_hours), 0) * 100, 2
        )                                                                AS overall_ratio_pct
      FROM tasks t
      JOIN employees e ON e.id = t.assignee_id
      JOIN list_statuses ls ON t.list_status_id = ls.id
      WHERE ls.type IN ('completed', 'done')
        AND t.time_estimate_hours > 0
        AND t.deleted_at IS NULL
        AND t.completed_at BETWEEN '${start}'::date AND ('${end}'::date + interval '1 day')
        AND ${empCondition}
      GROUP BY e.id, e.name, e.employee_code, e.avatar_url, e.department
      ORDER BY accuracy_pct DESC NULLS LAST
    `));

    return { period: { start, end }, data: rows };
  },

  /** หา status columns ที่ task ค้างนานที่สุด */
  async getBottleneck() {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        ls.id              AS status_id,
        ls.name            AS status_name,
        ls.color,
        ls.type            AS status_type,
        l.id               AS list_id,
        l.name             AS list_name,
        COUNT(t.id)        AS task_count,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 86400.0
        )::numeric, 1)     AS avg_days_stuck,
        MAX(
          EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 86400.0
        )::integer          AS max_days_stuck,
        ROUND(AVG(t.story_points)::numeric, 1) AS avg_story_points
      FROM tasks t
      JOIN list_statuses ls ON ls.id = t.list_status_id
      JOIN lists l          ON l.id  = ls.list_id
      WHERE ls.type NOT IN ('completed','cancelled')
        AND t.deleted_at IS NULL
      GROUP BY ls.id, ls.name, ls.color, ls.type, l.id, l.name
      HAVING COUNT(t.id) > 0
      ORDER BY avg_days_stuck DESC
    `));

    return rows;
  },

  /** workload ของแต่ละคนในทีม */
  async getTeamWorkload(params: { userId: string; userRole: string }) {
    const { userId, userRole } = params;

    // manager เห็นเฉพาะทีมตัวเอง, admin เห็นทั้งหมด
    const managerCondition =
      userRole === "manager"
        ? `AND e.manager_id = '${userId}'::uuid`
        : "";

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        e.id,
        e.name,
        e.employee_code,
        e.avatar_url,
        e.department,
        e.role,
        COUNT(t.id)    FILTER (
          WHERE ls.type NOT IN ('completed','cancelled','done','closed') AND t.deleted_at IS NULL
        )                                                                           AS active_tasks,
        COUNT(t.id)    FILTER (
          WHERE ls.type IN ('completed','done')
            AND t.completed_at >= NOW() - interval '7 days'
            AND t.deleted_at IS NULL
        )                                                                           AS done_this_week,
        COALESCE(SUM(t.story_points) FILTER (
          WHERE ls.type NOT IN ('completed','cancelled','done','closed') AND t.deleted_at IS NULL
        ), 0)                                                                       AS active_points,
        COALESCE(SUM(t.time_estimate_hours) FILTER (
          WHERE ls.type NOT IN ('completed','cancelled','done','closed') AND t.deleted_at IS NULL
        ), 0)                                                                       AS estimate_hours,
        COUNT(t.id)    FILTER (
          WHERE (t.deadline < NOW() AND ls.type NOT IN ('completed','cancelled','done','closed'))
            AND t.deleted_at IS NULL
        )                                                                           AS overdue_tasks
      FROM employees e
      LEFT JOIN tasks t ON t.assignee_id = e.id
      LEFT JOIN list_statuses ls ON ls.id = t.list_status_id
      WHERE e.is_active = true
        ${managerCondition}
      GROUP BY e.id, e.name, e.employee_code, e.avatar_url, e.department, e.role
      ORDER BY active_points DESC, active_tasks DESC
    `));

    return rows;
  },
};

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsRepository = {
  /** รายงานสัปดาห์ของ employee คนเดียว */
  async getWeeklyReport(params: WeeklyReportQuery & { userId: string; userRole: string }) {
    const { userId, userRole, employee_id, week } = params;
    const weekStart = week ? getWeekStart(week) : getWeekStart();

    let empCondition: string;
    if (userRole === "employee") {
      empCondition = `wr.employee_id = '${userId}'::uuid`;
    } else if (employee_id) {
      empCondition = `wr.employee_id = '${employee_id}'::uuid`;
    } else {
      empCondition = `wr.employee_id = '${userId}'::uuid`;
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        wr.*,
        e.name           AS employee_name,
        e.employee_code,
        e.avatar_url,
        e.department
      FROM weekly_reports wr
      JOIN employees e ON e.id = wr.employee_id
      WHERE ${empCondition}
        AND wr.week_start = '${weekStart}'::date
      LIMIT 1
    `));

    return rows[0] ?? null;
  },

  /** รายงานสัปดาห์ของทีม manager */
  async getWeeklyTeamReport(params: { week?: string | undefined; userId: string; userRole: string }) {
    const { userId, userRole, week } = params;
    // default สัปดาห์ที่แล้ว (เพราะสัปดาห์นี้ยังไม่จบ)
    const lastMonday = new Date();
    lastMonday.setDate(lastMonday.getDate() - 7);
    const weekStart = week ? getWeekStart(week) : getWeekStart(lastMonday);

    const managerCondition =
      userRole === "manager"
        ? `AND e.manager_id = '${userId}'::uuid`
        : "";

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        wr.id,
        wr.employee_id,
        e.name           AS employee_name,
        e.employee_code,
        e.avatar_url,
        e.department,
        wr.week_start,
        wr.tasks_done,
        wr.tasks_overdue,
        wr.total_manday,
        wr.actual_hours,
        wr.expected_points,
        wr.actual_points,
        wr.performance_ratio,
        wr.performance_label,
        wr.avg_score,
        wr.rank
      FROM weekly_reports wr
      JOIN employees e ON e.id = wr.employee_id
      WHERE wr.week_start = '${weekStart}'::date
        AND e.is_active = true
        ${managerCondition}
      ORDER BY wr.rank ASC NULLS LAST, wr.actual_points DESC
    `));

    return { week_start: weekStart, data: rows };
  },

  /** generate / upsert weekly_reports สำหรับสัปดาห์ที่ระบุ */
  async generateWeeklyReport(params: GenerateWeeklyReportInput) {
    const { week_start, employee_id } = params;
    const weekStart = week_start ? getWeekStart(week_start) : getWeekStart();
    const weekEnd   = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    // กำหนด employee filter
    const empFilter = employee_id
      ? `AND e.id = '${employee_id}'::uuid`
      : "";

    // Step 1: aggregate ข้อมูลจาก tasks + performance_config
    const aggregated = await db.execute<Record<string, unknown>>(sql.raw(`
      WITH task_agg AS (
        SELECT
          t.assignee_id                                                                AS employee_id,
          COUNT(*)  FILTER (
            WHERE ls.type IN ('completed','done')
              AND t.completed_at BETWEEN '${weekStart}'::date
                AND ('${weekEndStr}'::date + interval '1 day')
          )                                                                            AS tasks_done,
          COUNT(*)  FILTER (
            WHERE (t.deadline < ('${weekEndStr}'::date + interval '1 day')
                AND ls.type NOT IN ('completed','done','cancelled','closed'))
              AND t.deadline >= '${weekStart}'::date
          )                                                                            AS tasks_overdue,
          COALESCE(SUM(t.manday_estimate) FILTER (
            WHERE ls.type IN ('completed','done')
              AND t.completed_at BETWEEN '${weekStart}'::date
                AND ('${weekEndStr}'::date + interval '1 day')
          ), 0)                                                                        AS total_manday,
          COALESCE(SUM(t.actual_hours)    FILTER (
            WHERE ls.type IN ('completed','done')
              AND t.completed_at BETWEEN '${weekStart}'::date
                AND ('${weekEndStr}'::date + interval '1 day')
          ), 0)                                                                        AS actual_hours,
          -- นับเฉพาะ story_points ของ task type ที่ counts_for_points = true เท่านั้น
          COALESCE(SUM(
            CASE WHEN COALESCE(tt.counts_for_points, true) THEN t.story_points ELSE 0 END
          ) FILTER (
            WHERE ls.type IN ('completed','done')
              AND t.completed_at BETWEEN '${weekStart}'::date
                AND ('${weekEndStr}'::date + interval '1 day')
          ), 0)                                                                        AS actual_points
        FROM tasks t
        LEFT JOIN task_types tt ON tt.id = t.task_type_id
        LEFT JOIN list_statuses ls ON ls.id = t.list_status_id
        WHERE t.deleted_at IS NULL
        GROUP BY t.assignee_id
      ),
      config_agg AS (
        SELECT
          pc.employee_id,
          pc.point_target,
          pc.point_period,
          pc.expected_ratio,
          ws.days_per_week,
          ws.hours_per_day
        FROM employee_performance_config pc
        JOIN work_schedules ws ON ws.id = pc.work_schedule_id
      )
      SELECT
        e.id                                                                           AS employee_id,
        COALESCE(ta.tasks_done, 0)                                                     AS tasks_done,
        COALESCE(ta.tasks_overdue, 0)                                                  AS tasks_overdue,
        COALESCE(ta.total_manday, 0)                                                   AS total_manday,
        COALESCE(ta.actual_hours, 0)                                                   AS actual_hours,
        CASE
          WHEN ca.point_target IS NOT NULL AND ca.point_period = 'week'
          THEN ca.point_target
          ELSE NULL
        END                                                                            AS expected_points,
        COALESCE(ta.actual_points, 0)                                                  AS actual_points,
        CASE
          WHEN ca.point_target IS NOT NULL AND ca.point_period = 'week' AND ca.point_target > 0
          THEN ROUND((COALESCE(ta.actual_points,0) / ca.point_target)::numeric, 4)
          ELSE NULL
        END                                                                            AS performance_ratio
      FROM employees e
      LEFT JOIN task_agg   ta ON ta.employee_id = e.id
      LEFT JOIN config_agg ca ON ca.employee_id = e.id
      WHERE e.is_active = true ${empFilter}
    `));

    if (aggregated.length === 0) return { generated: 0, week_start: weekStart };

    // Step 2: คำนวณ performance_label + rank
    type Row = {
      employee_id: string;
      tasks_done: string | number;
      tasks_overdue: string | number;
      total_manday: string | number;
      actual_hours: string | number;
      expected_points: string | number | null;
      actual_points: string | number;
      performance_ratio: string | number | null;
    };

    const withLabel = (aggregated as unknown as Row[]).map((row) => {
      const ratio = row.performance_ratio != null ? parseFloat(String(row.performance_ratio)) : null;
      let label = "N/A";
      if (ratio != null) {
        if (ratio >= 1.2)       label = "Excellent";
        else if (ratio >= 1.0)  label = "Good";
        else if (ratio >= 0.8)  label = "Fair";
        else                    label = "Poor";
      }
      return { ...row, performance_label: label };
    });

    // Sort by actual_points DESC for rank
    const sorted = [...withLabel].sort((a, b) =>
      parseFloat(String(b.actual_points)) - parseFloat(String(a.actual_points))
    );
    const ranked = sorted.map((row, idx) => ({ ...row, rank: idx + 1 }));

    // Step 3: UPSERT weekly_reports
    let generated = 0;
    for (const row of ranked) {
      const {
        employee_id, tasks_done, tasks_overdue, total_manday, actual_hours,
        expected_points, actual_points, performance_ratio, performance_label, rank,
      } = row;

      const ep    = expected_points    != null ? expected_points    : "NULL";
      const ratio = performance_ratio  != null ? performance_ratio  : "NULL";

      await db.execute<Record<string, unknown>>(sql.raw(`
        INSERT INTO weekly_reports
          (employee_id, week_start, tasks_done, tasks_overdue, total_manday,
           actual_hours, expected_points, actual_points, performance_ratio,
           performance_label, rank)
        VALUES
          ('${employee_id}'::uuid, '${weekStart}'::date,
           ${tasks_done}, ${tasks_overdue}, ${total_manday},
           ${actual_hours}, ${ep}, ${actual_points}, ${ratio},
           '${performance_label}', ${rank})
        ON CONFLICT (employee_id, week_start)
          DO UPDATE SET
            tasks_done         = EXCLUDED.tasks_done,
            tasks_overdue      = EXCLUDED.tasks_overdue,
            total_manday       = EXCLUDED.total_manday,
            actual_hours       = EXCLUDED.actual_hours,
            expected_points    = EXCLUDED.expected_points,
            actual_points      = EXCLUDED.actual_points,
            performance_ratio  = EXCLUDED.performance_ratio,
            performance_label  = EXCLUDED.performance_label,
            rank               = EXCLUDED.rank,
            updated_at         = NOW()
      `));
      generated++;
    }

    return { generated, week_start: weekStart };
  },

  /** รายงาน HR รายเดือน */
  async getMonthlyHrReport(params: MonthlyHrReportQuery & { userId: string; userRole: string }) {
    const { userId, userRole, employee_id, year, month } = params;

    const now = new Date();
    const targetYear  = year  ?? now.getFullYear();
    const targetMonth = month ?? now.getMonth() + 1;

    let empCondition: string;
    if (userRole === "employee") {
      empCondition = `mr.employee_id = '${userId}'::uuid`;
    } else if (employee_id) {
      empCondition = `mr.employee_id = '${employee_id}'::uuid`;
    } else {
      empCondition = "TRUE";
    }

    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        mr.*,
        e.name           AS employee_name,
        e.employee_code,
        e.avatar_url,
        e.department
      FROM monthly_hr_reports mr
      JOIN employees e ON e.id = mr.employee_id
      WHERE ${empCondition}
        AND mr.year  = ${targetYear}
        AND mr.month = ${targetMonth}
      ORDER BY e.name ASC
    `));

    return { year: targetYear, month: targetMonth, data: rows };
  },
};
