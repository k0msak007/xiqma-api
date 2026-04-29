-- ─────────────────────────────────────────────────────────────────────────────
-- 015 — Leave + Time Reminder seed schedules
-- Why: add default bot schedules for leave reminders and time tracking nudges.
-- Uses contextKind "leave_reminder" and "time_reminder" (Phase 2.11c).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO bot_schedules (
  name, description, send_time, send_days, audience_type, audience_values,
  mode, title_template, body_template, context_kind, channels, notif_type, deep_link
) VALUES
(
  '📅 Leave Reminder',
  'เตือนวันลาของทีมวันนี้/พรุ่งนี้/ใน 7 วัน + โควต้าลาคงเหลือของแต่ละคน + pending รออนุมัติ (สำหรับหัวหน้า)',
  '08:00',
  ARRAY[1,2,3,4,5],
  'all', '{}'::text[],
  'ai',
  '📅 อัปเดตวันลา · {{weekday}} {{date}}',
  'สรุปวันลาของวันนี้ภาษาไทย 1-2 ประโยค: ถ้ามีคนลาวันนี้/พรุ่งนี้บอกชื่อและประเภทลา, {{leaveQuota}} ถ้ามีบอกโควต้าคงเหลือ, {{pendingLeaves}} ถ้ามีบอกว่าต้องอนุมัติอะไร ถ้าไม่มีใครลาเลยก็บอกว่าวันนี้ไม่มีใครลา',
  'leave_reminder',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/my-calendar'
),
(
  '⏱️ Time Reminder',
  'เตือนคนที่ยังไม่ log time ณ 16:00 ทุกวันทำการ — บอกว่าวันนี้ log ไปกี่ชม. หรือยังไม่ได้ log เลย',
  '16:00',
  ARRAY[1,2,3,4,5],
  'all', '{}'::text[],
  'static',
  '⏱️ Log time แล้วหรือยัง? · {{weekday}}',
  '{{timeLogged}}{{timeMissing}}
อย่าลืม log time ที่ /timesheet นะ!

💡 Tip: กด Start timer ตอนเริ่มงาน แล้วกด Stop เมื่อเสร็จ ระบบจะคำนวณเวลาให้อัตโนมัติ',
  'time_reminder',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/timesheet'
)
ON CONFLICT DO NOTHING;
