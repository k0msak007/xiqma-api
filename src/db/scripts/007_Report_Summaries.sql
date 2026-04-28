-- ─────────────────────────────────────────────────────────────────────────────
-- 007 — AI report summaries cache
-- Why: AI narrative generation costs $$ per call. Cache by (scope, range) and
--      reuse for 24h unless data changes.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_summaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type    TEXT NOT NULL,                 -- 'employee' | 'team' | 'space'
  scope_id      UUID NOT NULL,
  date_from     DATE NOT NULL,
  date_to       DATE NOT NULL,
  model         TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'th',
  summary_text  TEXT NOT NULL,
  data_hash     TEXT,                          -- to detect data drift
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_report_summaries_lookup
  ON report_summaries(scope_type, scope_id, date_from, date_to, language);
CREATE INDEX IF NOT EXISTS idx_report_summaries_expires
  ON report_summaries(expires_at);
