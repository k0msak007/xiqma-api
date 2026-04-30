-- ─────────────────────────────────────────────────────────────────────────────
-- 023 — Recurring Tasks
-- Why: auto-create task copies on daily/weekly/monthly schedule.
--      Parent task stores the rule; copies get created by cron.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_recurring          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_rule       TEXT,             -- 'daily' | 'weekly' | 'monthly'
  ADD COLUMN IF NOT EXISTS recurrence_interval   INTEGER DEFAULT 1, -- every N periods
  ADD COLUMN IF NOT EXISTS recurrence_days       INTEGER[],        -- ISO weekday 1-7, for weekly
  ADD COLUMN IF NOT EXISTS recurrence_end_date   DATE,             -- stop auto-creating after this
  ADD COLUMN IF NOT EXISTS recurrence_parent_id  UUID REFERENCES tasks(id) ON DELETE SET NULL;
