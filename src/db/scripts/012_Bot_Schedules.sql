-- ─────────────────────────────────────────────────────────────────────────────
-- 012 — Bot Schedules (configurable recurring AI/static messages)
-- Why: instead of hardcoding each "daily bot push", admin defines them via UI.
--   • End-of-day summary (AI, 18:00 mon-fri, all employees)
--   • Weekly recap (AI, fri 17:00, managers only)
--   • "วันเงินเดือน" reminder (static, every 25th)
--   • etc.
-- Standup remains its own dedicated system (deeply integrated).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                                       -- display name
  description     TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,

  -- Schedule (Asia/Bangkok)
  send_time       TIME    NOT NULL DEFAULT '08:00',
  send_days       INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],         -- ISO weekday 1=Mon..7=Sun
  -- Optional: only on specific day-of-month (1..31). NULL = all days that match send_days.
  send_day_of_month INTEGER,

  -- Audience
  audience_type   TEXT NOT NULL DEFAULT 'all',                         -- 'all'|'role'|'employee'
  audience_value  TEXT,                                                 -- role name (e.g. 'manager') or employee UUID; ignored if 'all'
  respect_work_days BOOLEAN NOT NULL DEFAULT true,                     -- skip employees on non-working days

  -- Message
  mode            TEXT NOT NULL DEFAULT 'ai',                          -- 'static' | 'ai'
  title_template  TEXT NOT NULL,                                        -- e.g. "สรุปวันนี้ของ {{name}}"
  body_template   TEXT NOT NULL,                                        -- AI prompt OR static body (with {{vars}})
  context_kind    TEXT NOT NULL DEFAULT 'today',                       -- 'today'|'yesterday'|'week'|'none'

  -- Channels
  channels        TEXT[] NOT NULL DEFAULT ARRAY['in_app']::text[],     -- subset of in_app|line|email
  notif_type      TEXT NOT NULL DEFAULT 'daily_summary',               -- maps to existing notif_type enum

  -- Deep link inserted as CTA
  deep_link       TEXT DEFAULT '/',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES employees(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_schedules_enabled
  ON bot_schedules (enabled);

-- Run log to dedupe: do not run same schedule twice in same hour-day
CREATE TABLE IF NOT EXISTS bot_schedule_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  UUID NOT NULL REFERENCES bot_schedules(id) ON DELETE CASCADE,
  run_date     DATE NOT NULL,
  run_hour     INTEGER NOT NULL,                  -- 0..23 Bangkok
  recipients   INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, run_date, run_hour)
);

CREATE INDEX IF NOT EXISTS idx_bot_schedule_runs_lookup
  ON bot_schedule_runs (schedule_id, run_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed defaults — End of day summary (everyone, mon-fri, 18:00, AI mode)
-- + Weekly recap (managers/admin, fri 17:00)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO bot_schedules (
  name, description, send_time, send_days, audience_type, audience_value,
  mode, title_template, body_template, context_kind, channels, notif_type, deep_link
) VALUES
(
  'สรุปวันนี้ (End of day)',
  'AI สรุปงานที่พนักงานทำไปวันนี้ ส่งเย็นทุกวันทำการ',
  '18:00',
  ARRAY[1,2,3,4,5],
  'all', NULL,
  'ai',
  '🌇 สรุปวันนี้ของคุณ',
  'เขียนสรุปสั้น ๆ (3-4 ประโยค) ของวันทำงานของพนักงานคนนี้ในภาษาไทย ใช้ข้อมูลจริง ไม่ต้องเดา ถ้าไม่ได้ทำงานก็พูดตรง ๆ จบด้วยคำให้กำลังใจสั้น ๆ',
  'today',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/'
),
(
  'Weekly Recap (Managers)',
  'AI สรุปสัปดาห์ ส่งให้ manager เย็นวันศุกร์',
  '17:00',
  ARRAY[5],
  'role', 'manager',
  'ai',
  '📊 สรุปสัปดาห์ของทีม',
  'เขียนสรุปสัปดาห์ของ manager คนนี้: ทีมทำงานไปกี่ task, on-time rate, รวมเวลา, จุดที่น่าชม, จุดที่ควรพูดคุย ใช้ภาษาไทย กระชับ',
  'week',
  ARRAY['in_app','line','email']::text[],
  'daily_summary',
  '/reports'
)
ON CONFLICT DO NOTHING;
