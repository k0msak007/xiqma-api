-- ─────────────────────────────────────────────────────────────────────────────
-- 010 — Standup Settings (org-level singleton)
-- Why: admin ตั้งเวลา/วันที่ระบบจะ generate daily standup
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS standup_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1,                  -- singleton (only row id=1)
  enabled             BOOLEAN NOT NULL DEFAULT true,
  send_time           TIME    NOT NULL DEFAULT '08:00',               -- Asia/Bangkok
  send_days           INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],    -- ISO weekday 1=Mon..7=Sun
  respect_work_days   BOOLEAN NOT NULL DEFAULT true,                  -- if true, also check each emp's work_days
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT standup_settings_singleton CHECK (id = 1)
);

-- Seed default row
INSERT INTO standup_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
