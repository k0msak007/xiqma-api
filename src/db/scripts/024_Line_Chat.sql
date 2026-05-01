-- ─────────────────────────────────────────────────────────────────────────────
-- 024 — LINE Chat Memory
-- Why: store conversation history so the AI assistant remembers context
--      across multiple messages (last 5 messages fed to LLM each time).
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS line_messages (
  id           SERIAL PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  employee_id  UUID NOT NULL REFERENCES employees(id),
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL,
  tool_calls   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lm_user_time
  ON line_messages (line_user_id, created_at DESC);

-- Clean up old messages (keep last 100 per user)
-- Run periodically via cron
