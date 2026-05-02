-- ─────────────────────────────────────────────────────────────────────────────
-- 027 — Fix FK cascade for list/folder/space deletion
-- Why: list_id NOT NULL + strict FK blocks cascading delete.
-- Fix: make list_id nullable + change FK to SET NULL.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Make tasks.list_id nullable (was NOT NULL)
ALTER TABLE tasks ALTER COLUMN list_id DROP NOT NULL;

-- 2) Recreate tasks → lists FK with ON DELETE SET NULL
DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name FROM pg_constraint
  WHERE conrelid = 'tasks'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%REFERENCES lists%'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_list_id_fkey
  FOREIGN KEY (list_id) REFERENCES lists(id)
  ON DELETE SET NULL;

-- 3) Recreate tasks → list_statuses FK with ON DELETE SET NULL
DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name FROM pg_constraint
  WHERE conrelid = 'tasks'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%REFERENCES list_statuses%'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_list_status_id_fkey
  FOREIGN KEY (list_status_id) REFERENCES list_statuses(id)
  ON DELETE SET NULL;

-- 4) notification_logs → tasks FK: SET NULL (preserve notification history)
DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name FROM pg_constraint
  WHERE conrelid = 'notification_logs'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%REFERENCES tasks%'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notification_logs DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE notification_logs
  ADD CONSTRAINT notification_logs_task_id_fkey
  FOREIGN KEY (task_id) REFERENCES tasks(id)
  ON DELETE SET NULL;

-- 5) notification_logs → employees FK: SET NULL
DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT conname INTO fk_name FROM pg_constraint
  WHERE conrelid = 'notification_logs'::regclass AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%(actor_id)%'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notification_logs DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE notification_logs
  ADD CONSTRAINT notification_logs_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES employees(id)
  ON DELETE SET NULL;
