import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { logger } from "@/lib/logger.ts";
import type { NotificationChannel, NotificationEvent } from "./events.ts";
import { inAppProvider } from "./providers/in-app.ts";
import { lineProvider }  from "./providers/line.ts";
import { emailProvider } from "./providers/email.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Notification dispatcher
//   fanOut(event) → for each recipient × each channel:
//     - check user_notification_prefs (must be enabled)
//     - check quiet hours (push channels only)
//     - delegate to provider
//
// Phase 2.4a-i: only InAppProvider is wired. LINE/Email come in 2.4b/2.4c.
// Errors per-recipient are swallowed (logged) so one failure can't kill a batch.
// ─────────────────────────────────────────────────────────────────────────────

async function loadPrefs(employeeId: string, eventType: string): Promise<Record<string, boolean>> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT channel, enabled FROM user_notification_prefs
    WHERE employee_id = '${employeeId}'::uuid AND event_type = '${eventType}'
  `));
  const arr = ((rows as any).rows ?? rows) as Array<Record<string, unknown>>;
  const out: Record<string, boolean> = {};
  for (const r of arr) out[String(r.channel)] = !!r.enabled;
  return out;
}

async function loadQuietHours(employeeId: string): Promise<{ start: string | null; end: string | null } | null> {
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT quiet_hours_start AS start, quiet_hours_end AS end
    FROM employees WHERE id = '${employeeId}'::uuid LIMIT 1
  `));
  const arr = ((rows as any).rows ?? rows) as Array<Record<string, unknown>>;
  const r = arr[0];
  if (!r) return null;
  return {
    start: r.start ? String(r.start) : null,
    end:   r.end   ? String(r.end)   : null,
  };
}

function inQuietHours(now: Date, startStr: string | null, endStr: string | null): boolean {
  if (!startStr || !endStr) return false;
  const [sh, sm] = startStr.split(":").map(Number) as [number, number];
  const [eh, em] = endStr.split(":").map(Number)   as [number, number];
  // Convert to Bangkok local time
  const bkk = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const cur = bkk.getHours() * 60 + bkk.getMinutes();
  const start = sh * 60 + sm;
  const end   = eh * 60 + em;
  if (start === end) return false;
  // Cross-midnight (e.g. 22:00 → 08:00)
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

const PUSH_CHANNELS: NotificationChannel[] = ["line", "email"];

export const notificationDispatcher = {
  /**
   * Resolve recipient prefs + quiet hours, then deliver via every enabled provider.
   * Errors are caught per-recipient × per-channel — one failure does not abort others.
   */
  async fanOut(event: NotificationEvent): Promise<void> {
    if (event.recipients.length === 0) return;

    const now = new Date();

    const restrict = event.channelOverride && event.channelOverride.length > 0
      ? new Set(event.channelOverride)
      : null;
    const allowed = (ch: NotificationChannel) => !restrict || restrict.has(ch);

    await Promise.all(event.recipients.map(async (recipientId) => {
      try {
        const prefs = await loadPrefs(recipientId, event.type);

        // in_app — always send if preference allows (no quiet hours for in-app)
        if (allowed("in_app") && prefs.in_app !== false) {
          try {
            await inAppProvider.deliver(event, recipientId);
          } catch (err) {
            logger.error({ err, recipientId, event: event.type }, "notification.in_app failed");
          }
        }

        // Push channels (line, email) — skip during quiet hours
        const qh = await loadQuietHours(recipientId);
        const isQuiet = qh ? inQuietHours(now, qh.start, qh.end) : false;

        for (const ch of PUSH_CHANNELS) {
          if (!allowed(ch)) {
            logger.info({ recipientId, event: event.type, ch }, "dispatcher: channel not in schedule.channels");
            continue;
          }
          if (prefs[ch] !== true) {
            logger.info({ recipientId, event: event.type, ch }, "dispatcher: user pref disabled");
            continue;
          }
          if (isQuiet) {
            logger.info({ recipientId, event: event.type, ch }, "dispatcher: in quiet hours — skipping push");
            continue;
          }
          if (ch === "line") {
            try {
              await lineProvider.deliver(event, recipientId);
            } catch (err) {
              logger.error({ err, recipientId, event: event.type }, "notification.line failed");
            }
          }
          if (ch === "email") {
            try {
              await emailProvider.deliver(event, recipientId);
            } catch (err) {
              logger.error({ err, recipientId, event: event.type }, "notification.email failed");
            }
          }
        }
      } catch (err) {
        logger.error({ err, recipientId, event: event.type }, "notification.fanOut failed");
      }
    }));
  },
};

// Convenience: emit event without awaiting (fire-and-forget for service callers
// who don't want to slow down their own response). Errors only log.
export function emitNotification(event: NotificationEvent): void {
  notificationDispatcher.fanOut(event).catch((err) => {
    logger.error({ err, event: event.type }, "notification.emit failed");
  });
}
