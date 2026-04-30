-- ─────────────────────────────────────────────────────────────────────────────
-- 019 — Weekly Hours Alert seed schedules
-- Why: interval schedules that check if employees have enough assigned hours
--      for the week, using data from employee_performance_config + work_schedules.
-- Uses contextKind "weekly_hours" and interval scheduling (Phase 2.11d/e).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Schedule 1: All employees — every 3 hours, Mon-Fri 09:00-18:00
INSERT INTO bot_schedules (
  name, description, send_time, send_days, audience_type, audience_values,
  mode, title_template, body_template, context_kind, channels, notif_type, deep_link,
  send_interval_type, send_interval_minutes, send_window_start, send_window_end
) VALUES
(
  '⏰ Weekly Hours · ของฉัน',
  'ตรวจสอบว่าพนักงานมีงาน assigned ครบชั่วโมงต่อสัปดาห์หรือยัง (เป้าหมายจาก Performance Config) — ส่งทุก 3 ชม.',
  '08:00',
  ARRAY[1,2,3,4,5],
  'all', '{}'::text[],
  'ai',
  '⏰ สถานะชั่วโมงงาน · {{weekday}}',
  'สรุปสถานะชั่วโมงงานสัปดาห์นี้ของพนักงานคนนี้ ภาษาไทย 1-2 ประโยค: เป้าหมาย {{targetHours}} ชม. ได้รับงานแล้ว {{weekAssignedHours}} ชม. log แล้ว {{weekLoggedHours}} ชม. {{#if hoursGap}}ขาดอีก {{hoursGap}} ชม. — แนะนำให้ติดต่อหัวหน้าเพื่อขอเพิ่ม{{/if}} {{#if hoursOk}}✅ ครบแล้ว เยี่ยมมาก{{/if}}',
  'weekly_hours',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/my-tasks',
  'interval', 180, '09:00', '18:00'
),
(
  '⏰ Weekly Hours · Manager',
  'Manager ตรวจสอบชั่วโมงงานของตัวเอง + แนะนำให้ตรวจสอบทีม — ส่งทุก 6 ชม.',
  '08:00',
  ARRAY[1,2,3,4,5],
  'role', ARRAY['manager']::text[],
  'ai',
  '⏰ ชั่วโมงงานคุณ · {{weekday}}',
  'สรุปชั่วโมงงานสัปดาห์นี้ของคุณ: เป้าหมาย {{targetHours}} ชม. ได้รับงาน {{weekAssignedHours}} ชม. log แล้ว {{weekLoggedHours}} ชม. {{#if hoursGap}}ยังขาด {{hoursGap}} ชม.{{/if}} 👥 ตรวจสอบทีมที่ /resources — ดูว่ามีลูกน้องคนไหนขาดชั่วโมงบ้าง',
  'weekly_hours',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/resources',
  'interval', 360, '09:00', '18:00'
)
ON CONFLICT DO NOTHING;

-- Also seed default prefs for those who don't have daily_summary prefs yet
INSERT INTO user_notification_prefs (employee_id, event_type, channel, enabled)
SELECT e.id, 'daily_summary', ch, true
FROM employees e
CROSS JOIN (VALUES ('in_app'), ('line'), ('email')) AS c(ch)
WHERE e.is_active = true
ON CONFLICT (employee_id, event_type, channel) DO NOTHING;
