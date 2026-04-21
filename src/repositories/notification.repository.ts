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

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          id:         notificationLogs.id,
          taskId:     notificationLogs.taskId,
          notifType:  notificationLogs.notifType,
          message:    notificationLogs.message,
          isRead:     notificationLogs.isRead,
          readAt:     notificationLogs.readAt,
          createdAt:  notificationLogs.createdAt,
          taskTitle:  tasks.title,
          taskDisplayId: tasks.displayId,
        })
        .from(notificationLogs)
        .leftJoin(tasks, eq(notificationLogs.taskId, tasks.id))
        .where(whereClause)
        .orderBy(desc(notificationLogs.createdAt))
        .limit(limit)
        .offset(offset),

      db.select({ count: count() }).from(notificationLogs).where(whereClause),
    ]);

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
};
