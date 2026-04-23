-- ─────────────────────────────────────────────────────────────────────────────
-- 006_Rework.sql
-- Rework tracking — track when a task is sent back from review/completed
-- ─────────────────────────────────────────────────────────────────────────────

-- Clean slate for re-runnability
DROP TABLE IF EXISTS task_rework_events CASCADE;
ALTER TABLE tasks DROP COLUMN IF EXISTS rework_count;
ALTER TABLE tasks DROP COLUMN IF EXISTS last_reworked_at;

-- Counter + timestamp on tasks
ALTER TABLE tasks
  ADD COLUMN rework_count     INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN last_reworked_at TIMESTAMPTZ;

-- Event log
CREATE TABLE task_rework_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status_id    UUID        REFERENCES list_statuses(id) ON DELETE SET NULL,
  to_status_id      UUID        REFERENCES list_statuses(id) ON DELETE SET NULL,
  from_status_name  TEXT,
  to_status_name    TEXT,
  reason            TEXT        NOT NULL,
  requested_by      UUID        NOT NULL REFERENCES employees(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rework_events_task    ON task_rework_events(task_id);
CREATE INDEX idx_rework_events_created ON task_rework_events(created_at DESC);
