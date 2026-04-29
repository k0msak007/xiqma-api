-- ─────────────────────────────────────────────────────────────────────────────
-- 017 — Weekly Auto-Report seed schedule
-- Why: last leftover item from Phase 2.11 — weekly summary sent to managers
--      every Monday 9am using the existing "week" context kind.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO bot_schedules (
  name, description, send_time, send_days, audience_type, audience_values,
  mode, title_template, body_template, context_kind, channels, notif_type, deep_link
) VALUES
(
  '📊 Weekly Auto-Report',
  'AI สรุปผลงานสัปดาห์ของทีม ส่งให้ manager ทุกเช้าวันจันทร์ ใช้ข้อมูลย้อนหลัง 7 วัน',
  '09:00',
  ARRAY[1],
  'role', ARRAY['manager']::text[],
  'ai',
  '📊 Weekly Report · {{weekday}} {{date}}',
  'เขียนสรุปผลงานสัปดาห์ของ manager คนนี้ ภาษาไทย: จำนวนงานที่ทีมทำเสร็จ, on-time rate, เวลารวม, จุดเด่นของทีม, จุดที่ควรพูดคุยหรือปรับปรุง จบด้วยให้กำลังใจ',
  'week',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/reports'
)
ON CONFLICT DO NOTHING;
