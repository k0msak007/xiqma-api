-- ─────────────────────────────────────────────────────────────────────────────
-- 016 — Multi-value audience support for bot schedules
-- Why: allow admin to select multiple roles or multiple employees as audience
--      instead of being limited to 1 role or 1 employee.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add new array column
ALTER TABLE bot_schedules ADD COLUMN IF NOT EXISTS audience_values TEXT[] DEFAULT '{}'::text[];

-- Migrate existing single-value data: role name or employee UUID → array
UPDATE bot_schedules
SET audience_values = CASE
  WHEN audience_value IS NOT NULL AND audience_value != '' THEN ARRAY[audience_value]
  ELSE '{}'::text[]
END
WHERE audience_values IS NULL OR array_length(audience_values, 1) IS NULL;

-- Also update the seed data that was inserted with single audience_value
UPDATE bot_schedules
SET audience_values = CASE
  WHEN audience_type = 'role' AND audience_value IS NOT NULL THEN ARRAY[audience_value]
  WHEN audience_type = 'employee' AND audience_value IS NOT NULL THEN ARRAY[audience_value]
  ELSE '{}'::text[]
END
WHERE (audience_values IS NULL OR array_length(audience_values, 1) IS NULL);
