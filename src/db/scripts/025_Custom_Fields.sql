-- ─────────────────────────────────────────────────────────────────────────────
-- 025 — Custom Fields per List
-- Why: allow admins to define extra fields per list (text, number, dropdown).
--      Task values stored as JSONB for flexibility.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS list_custom_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','select')),
  options       JSONB DEFAULT '[]'::jsonb,        -- for 'select' type: ["Option 1","Option 2"]
  required      BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lcf_list ON list_custom_fields (list_id, display_order);

-- Store custom field values directly on tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
