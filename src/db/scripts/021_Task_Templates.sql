-- ─────────────────────────────────────────────────────────────────────────────
-- 021 — Task Templates
-- Why: save reusable task blueprints so PMs don't re-type the same config.
--      Supports Phase 2.5 — Productivity primitives.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  task_type_id        UUID REFERENCES task_types(id) ON DELETE SET NULL,
  priority            TEXT,
  time_estimate_hours NUMERIC(5,1),
  story_points        INTEGER,
  tags                JSONB DEFAULT '[]'::jsonb,
  is_public           BOOLEAN NOT NULL DEFAULT true,
  created_by          UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_templates_public ON task_templates (is_public);
CREATE INDEX IF NOT EXISTS idx_task_templates_name ON task_templates (name);

-- Seed some useful defaults
INSERT INTO task_templates (name, title, description, priority, time_estimate_hours, tags) VALUES
(
  '🐛 Bug Fix',
  'Fix bug: [describe issue]',
  'Describe the bug, steps to reproduce, and expected behavior.',
  'high',
  4,
  '["bug","fix"]'::jsonb
),
(
  '🎨 Design Task',
  'ออกแบบ [describe]',
  'รายละเอียด design requirement, references, และ deliverables',
  'normal',
  8,
  '["design"]'::jsonb
),
(
  '📝 Documentation',
  'เขียนเอกสาร: [topic]',
  'Scope ของเอกสาร, target audience, format',
  'low',
  3,
  '["docs"]'::jsonb
),
(
  '🚀 Deploy',
  'Deploy [version/feature] to production',
  'Checklist: build passes, tests pass, staging verified, rollback plan ready',
  'urgent',
  2,
  '["deploy","ops"]'::jsonb
),
(
  '👤 Onboarding ลูกค้าใหม่',
  'Onboarding: [customer name]',
  'Set up account, configure workspace, add members, training session, follow-up call',
  'high',
  16,
  '["onboarding","customer"]'::jsonb
)
ON CONFLICT DO NOTHING;
