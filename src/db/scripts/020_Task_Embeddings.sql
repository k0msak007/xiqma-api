-- ─────────────────────────────────────────────────────────────────────────────
-- 020 — Task Embeddings (pgvector)
-- Why: store task title+description as vectors for semantic similarity search.
-- Unlocks Phase 2.10: Duration Estimator + NL Q&A.
-- Requires: pgvector extension enabled on the database.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Enable vector extension (must be run by superuser or via Supabase dashboard)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Task embeddings table
CREATE TABLE IF NOT EXISTS task_embeddings (
  task_id    UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  embedding  vector(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) HNSW index for fast cosine similarity search
-- Drop old index if exists (for idempotent re-runs)
DROP INDEX IF EXISTS idx_task_embeddings_hnsw;
CREATE INDEX idx_task_embeddings_hnsw
  ON task_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4) Config: increase ef_search for better recall at query time
-- (default is 40; higher = more accurate but slower. 100 is a good balance.)
-- This is a session-level setting; set in the embedding query or globally.
