-- ─────────────────────────────────────────────────────────────────────────────
-- 008 — Notification System foundation
-- Why: ตอนนี้มีตาราง notification_logs + Bell UI แต่ไม่มี service.create() +
--      ไม่มี event triggers. Phase 2.4a-i เริ่มที่ schema + prefs + channels.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Extend notif_type enum to cover events Phase 2.4a wires up
DO $$
BEGIN
  -- New event types
  ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'task_completed';
  ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'comment_mention';
  ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'comment_reply';
  ALTER TYPE notif_type ADD VALUE IF NOT EXISTS 'rework_requested';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2) Per-user notification preferences (event_type × channel toggles)
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  employee_id UUID    NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type  TEXT    NOT NULL,                   -- e.g. 'task_assigned'
  channel     TEXT    NOT NULL,                   -- 'in_app' | 'line' | 'email'
  enabled     BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, event_type, channel)
);
CREATE INDEX IF NOT EXISTS idx_unp_employee ON user_notification_prefs(employee_id);

-- 3) User-linked channels (LINE userId, custom email override, etc.)
CREATE TABLE IF NOT EXISTS user_channels (
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  channel     TEXT        NOT NULL,               -- 'line' | 'email'
  identifier  TEXT        NOT NULL,               -- LINE userId / email address
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, channel)
);

-- 4) Quiet hours per-user (defaults: 22:00 → 08:00)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS quiet_hours_start TIME NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_hours_end   TIME NOT NULL DEFAULT '08:00';

-- 5) Add metadata columns to notification_logs for richer events
ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS title         TEXT,
  ADD COLUMN IF NOT EXISTS related_type  TEXT,        -- 'task' | 'comment' | 'leave' | 'extension'
  ADD COLUMN IF NOT EXISTS related_id    UUID,
  ADD COLUMN IF NOT EXISTS deep_link     TEXT,        -- frontend route, e.g. '/task/abc#comment-123'
  ADD COLUMN IF NOT EXISTS actor_id      UUID REFERENCES employees(id);

-- 6) Allow notification_logs.task_id to be NULL safely (already nullable, just confirm)
-- (no-op if already nullable)

-- 7) Seed default prefs for every active employee × every event type × every channel
-- Default policy: in_app=on, line=off, email=off
WITH employees_active AS (
  SELECT id FROM employees WHERE is_active = true
),
events AS (
  SELECT unnest(ARRAY[
    'assigned',
    'task_completed',
    'comment_mention',
    'comment_reply',
    'rework_requested',
    'extension_request',
    'extension_approved',
    'extension_rejected',
    'leave_request',
    'leave_approved',
    'leave_rejected',
    'due_reminder',
    'overdue',
    'daily_summary',
    'announcement'
  ]) AS event_type
),
channels AS (
  SELECT unnest(ARRAY['in_app', 'line', 'email']) AS channel
)
INSERT INTO user_notification_prefs (employee_id, event_type, channel, enabled)
SELECT
  ea.id,
  ev.event_type,
  ch.channel,
  CASE WHEN ch.channel = 'in_app' THEN true ELSE false END
FROM employees_active ea
CROSS JOIN events ev
CROSS JOIN channels ch
ON CONFLICT (employee_id, event_type, channel) DO NOTHING;
