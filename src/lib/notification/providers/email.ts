import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { sendEmail, buildNotificationEmail } from "@/lib/email.ts";
import { logger } from "@/lib/logger.ts";
import type { NotificationEvent } from "../events.ts";

// Email provider for the notification dispatcher.
// Looks up the recipient's email and sends a Resend email if RESEND_API_KEY is set.

async function getEmail(employeeId: string): Promise<string | null> {
  // Prefer override in user_channels (verified email), fall back to employees.email
  const ucRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT identifier FROM user_channels
    WHERE employee_id = '${employeeId}'::uuid
      AND channel = 'email'
      AND verified_at IS NOT NULL
    LIMIT 1
  `));
  const uc = (((ucRows as any).rows ?? ucRows) as any[])[0];
  if (uc?.identifier) return String(uc.identifier);

  const empRows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT email FROM employees WHERE id = '${employeeId}'::uuid LIMIT 1
  `));
  const e = (((empRows as any).rows ?? empRows) as any[])[0];
  return e?.email ? String(e.email) : null;
}

function colorFor(eventType: string): string {
  switch (eventType) {
    case "rework_requested":   return "#F59E0B";
    case "overdue":            return "#EF4444";
    case "due_reminder":       return "#FB923C";
    case "task_completed":     return "#10B981";
    case "extension_request":  return "#8B5CF6";
    case "extension_approved": return "#10B981";
    case "extension_rejected": return "#EF4444";
    case "comment_mention":    return "#D946EF";
    case "comment_reply":      return "#8B5CF6";
    case "daily_summary":      return "#FB7185";
    case "assigned":           return "#FB7185";
    default:                   return "#FB7185";
  }
}

function appBase(): string {
  return process.env.APP_BASE_URL ?? "https://xiqma.app";
}

export const emailProvider = {
  async deliver(event: NotificationEvent, recipientId: string): Promise<void> {
    if (!process.env.RESEND_API_KEY) {
      logger.warn({ recipientId }, "email provider skipped — RESEND_API_KEY not set");
      return;
    }

    const to = await getEmail(recipientId);
    if (!to) {
      logger.info({ recipientId, event: event.type }, "email provider skipped — no email address for recipient");
      return;
    }
    logger.info({ recipientId, event: event.type, to }, "email provider sending...");

    const cta = event.deepLink
      ? { label: "เปิดใน Xiqma", uri: `${appBase()}${event.deepLink}` }
      : undefined;

    const { html, text } = buildNotificationEmail({
      title:       event.title,
      body:        event.body ?? null,
      headerColor: colorFor(event.type),
      cta,
    });

    await sendEmail({ to, subject: event.title, html, text });
  },
};
