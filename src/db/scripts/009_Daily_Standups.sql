-- ─────────────────────────────────────────────────────────────────────────────
-- 009 — Daily Standups (AI-generated)
-- Why: morning summary of yesterday's work + today's plan, drafted by AI for
--      each employee, reviewable & sendable by the user.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_standups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          DATE NOT NULL,                              -- the standup date (today, in Asia/Bangkok)
  draft_text    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',            -- 'pending' | 'sent' | 'skipped'
  model         TEXT,                                       -- AI model used
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  edited_at     TIMESTAMPTZ,
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_standups_employee_date
  ON daily_standups (employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_standups_date
  ON daily_standups (date DESC);
