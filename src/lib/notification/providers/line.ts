import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { pushFlex, buildNotificationFlex } from "@/lib/line.ts";
import { logger } from "@/lib/logger.ts";
import type { NotificationEvent } from "../events.ts";

// LINE provider: looks up the recipient's verified line_user_id and pushes a
// Flex Message. Returns silently if the user hasn't linked LINE yet.

async function getLineUserId(employeeId: string): Promise<string | null> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT identifier FROM user_channels
    WHERE employee_id = '${employeeId}'::uuid
      AND channel = 'line'
      AND verified_at IS NOT NULL
    LIMIT 1
  `));
  const r = (((rows as any).rows ?? rows) as any[])[0];
  return r?.identifier ? String(r.identifier) : null;
}

// Map event type → header color (matches Soft Sunrise theme + intent)
function colorFor(eventType: string): string {
  switch (eventType) {
    case "rework_requested":   return "#F59E0B"; // amber
    case "overdue":            return "#EF4444"; // red
    case "due_reminder":       return "#FB923C"; // orange
    case "task_completed":     return "#10B981"; // emerald
    case "extension_request":  return "#8B5CF6"; // violet
    case "extension_approved": return "#10B981"; // emerald
    case "extension_rejected": return "#EF4444"; // red
    case "comment_mention":    return "#D946EF"; // fuchsia
    case "comment_reply":      return "#8B5CF6"; // violet
    case "daily_summary":      return "#FB7185"; // rose
    case "assigned":           return "#FB7185"; // rose
    default:                   return "#FB7185";
  }
}

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? process.env.PUBLIC_APP_URL ?? "https://xiqma.app";
}

export const lineProvider = {
  async deliver(event: NotificationEvent, recipientId: string): Promise<void> {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      logger.warn({ recipientId }, "line provider skipped — LINE_CHANNEL_ACCESS_TOKEN not set");
      return;
    }

    const lineUserId = await getLineUserId(recipientId);
    if (!lineUserId) {
      logger.info({ recipientId, event: event.type }, "line provider skipped — user has not linked LINE");
      return;
    }
    logger.info({ recipientId, event: event.type, lineUserId }, "line provider sending...");

    const cta = event.deepLink
      ? { label: "เปิดใน Xiqma", uri: `${appBaseUrl()}${event.deepLink}` }
      : undefined;

    const flex = buildNotificationFlex({
      title:        event.title,
      body:         event.body ?? null,
      headerColor:  colorFor(event.type),
      cta,
    });

    await pushFlex(lineUserId, {
      altText: event.title,
      contents: flex,
    });
  },
};
