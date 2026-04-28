import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import type { NotificationEvent, NotificationEventType } from "../events.ts";

// In-app provider: write into existing notification_logs table.
// Bell UI polls and reads these rows.
export const inAppProvider = {
  async deliver(event: NotificationEvent, recipientId: string): Promise<void> {
    const sqlSafe = (v: string | null | undefined) =>
      v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

    const taskIdSql      = event.taskId ? `'${event.taskId}'::uuid` : "NULL";
    const relatedIdSql   = event.relatedId ? `'${event.relatedId}'::uuid` : "NULL";
    const actorIdSql     = event.actorId ? `'${event.actorId}'::uuid` : "NULL";

    await db.execute(sql.raw(`
      INSERT INTO notification_logs
        (task_id, employee_id, notif_type, message, title,
         related_type, related_id, deep_link, actor_id, is_sent, sent_at)
      VALUES
        (${taskIdSql},
         '${recipientId}'::uuid,
         '${mapEnum(event.type)}'::notif_type,
         ${sqlSafe(event.body ?? event.title)},
         ${sqlSafe(event.title)},
         ${sqlSafe(event.relatedType ?? null)},
         ${relatedIdSql},
         ${sqlSafe(event.deepLink ?? null)},
         ${actorIdSql},
         true,
         NOW())
    `));
  },
};

// Map our internal event types to the actual Postgres enum values that exist
// after migration 008 has been applied.
function mapEnum(t: NotificationEventType): NotificationEventType {
  return t;
}
