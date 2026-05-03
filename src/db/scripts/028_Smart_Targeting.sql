-- ─────────────────────────────────────────────────────────────────────────────
-- 028 — Smart Targeting: conditions for bot schedule audience
-- Why: allow admin to target managers+admins with conditional delivery
--      based on team performance (e.g., only notify managers whose
--      subordinates are below working hours target).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bot_schedules
  ADD COLUMN IF NOT EXISTS condition_kind   TEXT DEFAULT 'none',   -- 'none' | 'team_hours_below_target' | 'team_has_overdue'
  ADD COLUMN IF NOT EXISTS condition_params JSONB DEFAULT '{}'::jsonb;  -- { threshold_pct: 80 }
