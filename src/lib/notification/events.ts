// ─────────────────────────────────────────────────────────────────────────────
// Notification event definitions.
// Phase 2.4a-i wires: task_assigned, task_completed, comment_mention.
// More events get added in 2.4a-ii (rework, extension, due-soon, overdue).
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationEventType =
  | "assigned"            // task assigned to user (matches existing enum 'assigned')
  | "task_completed"
  | "comment_mention"
  | "comment_reply"
  | "rework_requested"
  | "extension_request"
  | "extension_approved"
  | "extension_rejected"
  | "leave_request"
  | "leave_approved"
  | "leave_rejected"
  | "due_reminder"
  | "overdue"
  | "daily_summary"
  | "announcement";

export type NotificationChannel = "in_app" | "line" | "email";

export interface NotificationEvent {
  type:        NotificationEventType;
  recipients:  string[];        // employee ids
  actorId?:    string;          // who triggered the event (NULL = system)
  title:       string;          // short headline ("มีงานใหม่: ทำ Landing Page")
  body?:       string;          // optional longer text
  relatedType?: "task" | "comment" | "leave" | "extension" | null;
  relatedId?:  string | null;
  deepLink?:   string | null;   // e.g. '/task/abc' or '/leave/123'
  taskId?:     string | null;   // for backward-compat with existing notification_logs.task_id
  /**
   * Optional restriction: only deliver via these channels (still respecting user prefs).
   * Used by bot_schedules to enforce per-schedule channel selection.
   */
  channelOverride?: NotificationChannel[];
}

// Helper: dedupe + remove blanks/self-notify
export function normalizeRecipients(recipients: (string | null | undefined)[], excludeActorId?: string): string[] {
  const set = new Set<string>();
  for (const r of recipients) {
    if (!r) continue;
    if (excludeActorId && r === excludeActorId) continue;
    set.add(r);
  }
  return Array.from(set);
}
