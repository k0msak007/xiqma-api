-- ─────────────────────────────────────────────────────────────────────────────
-- 006 — Auto manage tasks.completed_at based on list_statuses.type
-- Why: single source of truth for "is this task done?"
--   Set   completed_at = NOW()  when status type ∈ {done,completed,closed,cancelled}
--   Clear completed_at = NULL   when moved back to a non-terminal type (reopen)
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER  IF EXISTS trg_tasks_auto_completed_at ON tasks;
DROP FUNCTION IF EXISTS fn_tasks_auto_completed_at();

CREATE OR REPLACE FUNCTION fn_tasks_auto_completed_at()
RETURNS TRIGGER AS $$
DECLARE
  new_type status_type;
  old_type status_type;
  terminal CONSTANT text[] := ARRAY['done','completed','closed','cancelled'];
BEGIN
  -- Resolve new status type (NULL-safe)
  IF NEW.list_status_id IS NOT NULL THEN
    SELECT type INTO new_type FROM list_statuses WHERE id = NEW.list_status_id;
  END IF;

  -- On INSERT: if starting with a terminal status, stamp completed_at
  IF TG_OP = 'INSERT' THEN
    IF new_type::text = ANY(terminal) AND NEW.completed_at IS NULL THEN
      NEW.completed_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- On UPDATE: only act if status actually changed
  IF TG_OP = 'UPDATE' AND NEW.list_status_id IS DISTINCT FROM OLD.list_status_id THEN
    IF OLD.list_status_id IS NOT NULL THEN
      SELECT type INTO old_type FROM list_statuses WHERE id = OLD.list_status_id;
    END IF;

    -- Moved INTO terminal → stamp (if user hasn't already set completed_at in this update)
    IF new_type::text = ANY(terminal)
       AND (old_type IS NULL OR old_type::text <> ALL(terminal))
       AND NEW.completed_at IS NULL
    THEN
      NEW.completed_at := NOW();
    END IF;

    -- Moved OUT of terminal → clear (reopen)
    IF (new_type IS NULL OR new_type::text <> ALL(terminal))
       AND old_type::text = ANY(terminal)
    THEN
      NEW.completed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_auto_completed_at
  BEFORE INSERT OR UPDATE OF list_status_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION fn_tasks_auto_completed_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: existing tasks that are in terminal status but have no completed_at
-- Use updated_at as best-guess timestamp.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE tasks t
SET completed_at = t.updated_at
FROM list_statuses ls
WHERE t.list_status_id = ls.id
  AND ls.type::text IN ('done','completed','closed','cancelled')
  AND t.completed_at IS NULL;

-- Also clear completed_at on any task whose status is NOT terminal but has stamp
-- (data consistency; shouldn't happen post-trigger but cleans up legacy rows).
UPDATE tasks t
SET completed_at = NULL
FROM list_statuses ls
WHERE t.list_status_id = ls.id
  AND ls.type::text NOT IN ('done','completed','closed','cancelled')
  AND t.completed_at IS NOT NULL;
