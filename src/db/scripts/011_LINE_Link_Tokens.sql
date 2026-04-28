-- ─────────────────────────────────────────────────────────────────────────────
-- 011 — LINE Link Tokens (short-lived pairing)
-- Why: user generates 6-digit token in Xiqma → DMs it to bot → webhook matches
--      → saves line_user_id in user_channels.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS line_link_tokens (
  token       TEXT PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_line_link_tokens_employee
  ON line_link_tokens (employee_id);
CREATE INDEX IF NOT EXISTS idx_line_link_tokens_expires
  ON line_link_tokens (expires_at);
