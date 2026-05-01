-- ─────────────────────────────────────────────────────────────────────────────
-- 026 — Public Share Links
-- Why: generate read-only public links for tasks to share with external people.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS share_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links (token);
CREATE INDEX IF NOT EXISTS idx_share_links_task ON share_links (task_id);
