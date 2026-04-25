-- ─────────────────────────────────────────────────────────────────────────────
-- 005 — Make plan_finish editable (was GENERATED)
-- Why: naive plan_start + duration math ignores non-working days (weekends,
--      holidays). App layer now computes plan_finish respecting work_days
--      from the assignee's performance config.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tasks'
      AND column_name = 'plan_finish'
      AND is_generated = 'ALWAYS'
  ) THEN
    -- Drop GENERATED constraint by dropping + re-adding the column.
    -- Step 1: add a temp column holding current computed values.
    ALTER TABLE tasks ADD COLUMN plan_finish_tmp DATE;
    UPDATE tasks SET plan_finish_tmp = plan_finish;

    ALTER TABLE tasks DROP COLUMN plan_finish;
    ALTER TABLE tasks RENAME COLUMN plan_finish_tmp TO plan_finish;
  END IF;
END $$;
