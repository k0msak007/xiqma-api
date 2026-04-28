-- ─────────────────────────────────────────────────────────────────────────────
-- 013 — Open up channels on seeded bot schedules
-- Why: by default seeded schedules only used 'in_app'. Now opening to all 3
--      channels so admin doesn't have to toggle each. User-level prefs still
--      gate per-recipient (so this is safe).
-- Also: enable daily_summary × line/email by default for all employees so they
--      receive bot messages when channel is linked.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Open channels on the 2 seeded schedules (only if they haven't been customized)
UPDATE bot_schedules
SET channels = ARRAY['in_app','line','email']::text[]
WHERE name IN ('สรุปวันนี้ (End of day)', 'Weekly Recap (Managers)')
  AND channels = ARRAY['in_app']::text[];

-- 2) Default user prefs for "daily_summary" → enable line + email
--    Flip existing rows that are currently disabled (default seeded value).
--    Insert if missing.
UPDATE user_notification_prefs
SET enabled = true, updated_at = NOW()
WHERE event_type = 'daily_summary'
  AND channel IN ('line', 'email')
  AND enabled = false;

INSERT INTO user_notification_prefs (employee_id, event_type, channel, enabled)
SELECT e.id, 'daily_summary', ch, true
FROM employees e
CROSS JOIN (VALUES ('line'), ('email')) AS c(ch)
WHERE e.is_active = true
ON CONFLICT (employee_id, event_type, channel)
  DO NOTHING;
