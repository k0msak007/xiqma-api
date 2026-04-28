import { and, desc, eq, sql, count } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { notificationLogs } from "@/db/schema/logs.schema.ts";
import { tasks } from "@/db/schema/tasks.schema.ts";

export interface ListNotificationsParams {
  employeeId: string;
  unread?:    boolean;
  page:       number;
  limit:      number;
}

export const notificationRepository = {
  async findAll(params: ListNotificationsParams) {
    const { employeeId, unread, page, limit } = params;
    const offset = (page - 1) * limit;

    const conditions = [eq(notificationLogs.employeeId, employeeId)];
    if (unread === true)  conditions.push(eq(notificationLogs.isRead, false));
    if (unread === false) conditions.push(eq(notificationLogs.isRead, true));
    const whereClause = and(...conditions);

    // Use raw SQL to include columns added by migration 008 (title, deep_link, related_*).
    const offsetSafe = Number(offset) | 0;
    const limitSafe  = Number(limit)  | 0;
    const unreadFilter =
      unread === true  ? "AND n.is_read = false" :
      unread === false ? "AND n.is_read = true"  : "";

    const rawRows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT
        n.id::text        AS "id",
        n.task_id::text   AS "taskId",
        n.notif_type::text AS "notifType",
        n.message         AS "message",
        n.title           AS "title",
        n.deep_link       AS "deepLink",
        n.related_type    AS "relatedType",
        n.related_id::text AS "relatedId",
        n.actor_id::text  AS "actorId",
        n.is_read         AS "isRead",
        n.read_at         AS "readAt",
        n.created_at      AS "createdAt",
        t.title           AS "taskTitle",
        t.display_id      AS "taskDisplayId"
      FROM notification_logs n
      LEFT JOIN tasks t ON n.task_id = t.id
      WHERE n.employee_id = '${employeeId}'::uuid
        ${unreadFilter}
      ORDER BY n.created_at DESC
      LIMIT ${limitSafe} OFFSET ${offsetSafe}
    `));
    const rows = ((rawRows as any).rows ?? rawRows) as any[];

    const totalResult = await db.select({ count: count() }).from(notificationLogs).where(whereClause);
    return { rows, total: totalResult[0]?.count ?? 0 };
  },

  async findById(id: string) {
    return db.query.notificationLogs.findFirst({
      where: eq(notificationLogs.id, id),
    });
  },

  async markRead(id: string) {
    const [row] = await db
      .update(notificationLogs)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notificationLogs.id, id))
      .returning();
    return row;
  },

  async markAllRead(employeeId: string) {
    const result = await db.execute(sql`
      UPDATE notification_logs
      SET is_read = true, read_at = NOW()
      WHERE employee_id = ${employeeId}::uuid AND is_read = false
    `);
    return { updated: (result as unknown as { count?: number }).count ?? 0 };
  },

  // ── Preferences (Phase 2.4a-ii) ─────────────────────────────────────────────
  async getPrefs(employeeId: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT event_type, channel, enabled
      FROM user_notification_prefs
      WHERE employee_id = '${employeeId}'::uuid
      ORDER BY event_type, channel
    `));
    const arr = ((rows as any).rows ?? rows) as any[];
    return arr.map((r) => ({
      eventType: String(r.event_type),
      channel:   String(r.channel),
      enabled:   !!r.enabled,
    }));
  },

  async upsertPref(employeeId: string, eventType: string, channel: string, enabled: boolean) {
    await db.execute(sql.raw(`
      INSERT INTO user_notification_prefs (employee_id, event_type, channel, enabled, updated_at)
      VALUES ('${employeeId}'::uuid, '${eventType}', '${channel}', ${enabled}, NOW())
      ON CONFLICT (employee_id, event_type, channel)
      DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
    `));
  },

  async getQuietHours(employeeId: string) {
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT quiet_hours_start::text AS start, quiet_hours_end::text AS end
      FROM employees WHERE id = '${employeeId}'::uuid LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return r ? { start: String(r.start), end: String(r.end) } : null;
  },

  async setQuietHours(employeeId: string, start: string, end: string) {
    await db.execute(sql.raw(`
      UPDATE employees SET quiet_hours_start = '${start}'::time, quiet_hours_end = '${end}'::time
      WHERE id = '${employeeId}'::uuid
    `));
  },
};
