// ─────────────────────────────────────────────────────────────────────────────
// Backfill script — generate embeddings for existing tasks that don't have one.
// Run: bun run src/scripts/backfill-embeddings.ts
// Safe to re-run — only processes tasks missing from task_embeddings.
// ─────────────────────────────────────────────────────────────────────────────

import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { embedText, createEmbedding, toVectorLiteral } from "@/lib/embedding.ts";
import { logger } from "@/lib/logger.ts";

async function main() {
  logger.info({}, "backfill-embeddings started");
  
  // Find tasks that don't have embeddings yet
  const rows = await db.execute<Record<string, unknown>>(sql.raw(`
    SELECT t.id::text, t.title, t.description
    FROM tasks t
    WHERE t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_embeddings te WHERE te.task_id = t.id
      )
    ORDER BY t.created_at
  `));
  
  const tasks = ((rows as any).rows ?? rows) as Array<{
    id: string; title: string; description: string | null;
  }>;
  
  logger.info({ count: tasks.length }, "tasks without embeddings found");
  
  let done = 0;
  let failed = 0;
  
  for (const task of tasks) {
    try {
      const text = embedText({ title: task.title, description: task.description });
      if (!text) continue;
      
      const embedding = await createEmbedding(text);
      const vec = toVectorLiteral(embedding);
      
      await db.execute(sql.raw(`
        INSERT INTO task_embeddings (task_id, embedding, updated_at)
        VALUES ('${task.id}'::uuid, ${vec}, NOW())
        ON CONFLICT (task_id) DO UPDATE SET embedding = ${vec}, updated_at = NOW()
      `));
      
      done++;
      if (done % 50 === 0) {
        logger.info({ done, remaining: tasks.length - done - failed }, "backfill progress");
      }
    } catch (err) {
      failed++;
      logger.error({ err, taskId: task.id }, "backfill embedding failed");
    }
  }
  
  logger.info({ total: tasks.length, done, failed }, "backfill-embeddings completed");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "backfill-embeddings fatal");
  process.exit(1);
});
