-- ============================================================
-- 003 — SUBTASKS (Checklist) for Tasks
-- Stack: PostgreSQL (Supabase)
--
-- Safe to re-run: drops existing view/trigger/table first.
-- ============================================================

-- Clean slate (order matters: view → trigger → table)
DROP VIEW     IF EXISTS task_subtask_progress;
DROP TRIGGER  IF EXISTS trg_subtasks_updated_at ON subtasks;
DROP FUNCTION IF EXISTS set_subtask_updated_at();
DROP TABLE    IF EXISTS subtasks CASCADE;

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE subtasks (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id      UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  title        TEXT        NOT NULL,
  is_done      BOOLEAN     NOT NULL DEFAULT false,
  done_at      TIMESTAMPTZ,
  done_by      UUID        REFERENCES employees(id),

  order_index  INTEGER     NOT NULL DEFAULT 0,

  created_by   UUID        NOT NULL REFERENCES employees(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_subtasks_task_id    ON subtasks(task_id);
CREATE INDEX idx_subtasks_task_order ON subtasks(task_id, order_index);

-- ============================================================
-- TRIGGER — auto updated_at + auto stamp done_at / clear on undo
-- ============================================================
CREATE OR REPLACE FUNCTION set_subtask_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.is_done = true AND (OLD.is_done IS DISTINCT FROM true) THEN
    NEW.done_at = now();
  ELSIF NEW.is_done = false THEN
    NEW.done_at = NULL;
    NEW.done_by = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subtasks_updated_at
  BEFORE UPDATE ON subtasks
  FOR EACH ROW EXECUTE FUNCTION set_subtask_updated_at();

-- ============================================================
-- VIEW — progress % per parent task
-- ============================================================
CREATE VIEW task_subtask_progress AS
SELECT
  task_id,
  COUNT(*)                        AS total,
  COUNT(*) FILTER (WHERE is_done) AS done,
  CASE WHEN COUNT(*) = 0 THEN 0
       ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE is_done) / COUNT(*), 1)
  END                             AS percent_complete
FROM subtasks
GROUP BY task_id;

-- ============================================================
-- DONE
-- ============================================================
