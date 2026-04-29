-- ─────────────────────────────────────────────────────────────────────────────
-- 014 — Morning Briefing seed schedule
-- Why: add a default bot schedule that sends consolidated task urgency
--      (overdue + due today + due in 3 days) every morning.
-- Uses the new contextKind "morning_briefing" (Phase 2.11b).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO bot_schedules (
  name, description, send_time, send_days, audience_type, audience_values,
  mode, title_template, body_template, context_kind, channels, notif_type, deep_link
) VALUES
(
  '☀️ Morning Briefing',
  'AI สรุปรายการงานเกินกำหนด + งานวันนี้ + งานใกล้ครบ 3 วัน ส่งเช้าทุกวันทำการ',
  '08:00',
  ARRAY[1,2,3,4,5],
  'all', '{}'::text[],
  'ai',
  '☀️ อัปเดตงานเช้า {{name}} · {{weekday}} {{date}}',
  'สรุปรายการงานของพนักงานคนนี้วันนี้ ภาษาไทย กระชับ 2-4 ประโยค ถ้ามีงานเกินกำหนดให้บอกว่าเป็น priority แรก ถ้ามีงานวันนี้ให้บอกว่ามีกี่งาน ถ้าไม่มีงานอะไรเลยให้บอกว่าวันนี้โล่ง ให้กำลังใจ',
  'morning_briefing',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/my-tasks'
)
ON CONFLICT DO NOTHING;
