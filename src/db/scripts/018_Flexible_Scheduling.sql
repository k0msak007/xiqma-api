-- ─────────────────────────────────────────────────────────────────────────────
-- 018 — Flexible Interval Scheduling
-- Why: support interval-based schedules (every N minutes/hours within a
--      time window) in addition to fixed-time schedules.
-- Also enables per-minute dedupe for interval schedules.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add interval columns to bot_schedules
ALTER TABLE bot_schedules
  ADD COLUMN IF NOT EXISTS send_interval_type    TEXT DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS send_interval_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS send_window_start     TIME,
  ADD COLUMN IF NOT EXISTS send_window_end       TIME;

-- bot_schedule_runs — add minute-level dedupe
ALTER TABLE bot_schedule_runs
  ADD COLUMN IF NOT EXISTS run_minute INTEGER DEFAULT 0;

-- Drop old constraint (schedule_id, run_date, run_hour) and recreate with minute
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bot_schedule_runs_schedule_id_run_date_run_hour_key'
    AND conrelid = 'bot_schedule_runs'::regclass
  ) THEN
    ALTER TABLE bot_schedule_runs
      DROP CONSTRAINT bot_schedule_runs_schedule_id_run_date_run_hour_key;
    ALTER TABLE bot_schedule_runs
      ADD UNIQUE (schedule_id, run_date, run_hour, run_minute);
  END IF;
END $$;
