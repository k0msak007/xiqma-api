import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db.ts";
import { authMiddleware } from "@/middleware/auth.ts";
import { taskRepository } from "@/repositories/task.repository.ts";
import { ok } from "@/lib/response.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

function genToken(): string {
  return Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

export const shareLinksRouter = new Hono()
  // GET /api/tasks/:id/share — list active links
  .get("/api/tasks/:id/share", authMiddleware, async (c) => {
    const taskId = c.req.param("id");
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT token, created_at::text, expires_at::text,
        CASE WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN true ELSE false END AS expired
      FROM share_links WHERE task_id = '${taskId}'::uuid AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC LIMIT 5
    `));
    const links = ((rows as any).rows ?? rows as any[]).map((r: any) => ({
      token: r.token,
      url: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/share/${r.token}`,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? null,
      expired: !!r.expired,
    }));
    return ok(c, links, "ดึง share links สำเร็จ");
  })

  // POST /api/tasks/:id/share — create share link (auth required)
  .post("/api/tasks/:id/share", authMiddleware, async (c) => {
    const user = c.get("user");
    const taskId = c.req.param("id");
    const task = await taskRepository.findById(taskId);
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ task", 404);

    let expiresClause = "";
    try {
      const body = await c.req.json();
      const days = parseInt(body?.expires_in_days, 10);
      if (days > 0 && days <= 365) {
        expiresClause = `NOW() + INTERVAL '${days} days'`;
      }
    } catch {}

    const token = genToken();
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      INSERT INTO share_links (task_id, token, created_by${expiresClause ? ", expires_at" : ""})
      VALUES ('${taskId}'::uuid, '${token}', '${user.userId}'::uuid${expiresClause ? `, ${expiresClause}` : ""})
      RETURNING id::text, token, created_at::text, expires_at::text
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    return ok(c, {
      token: r.token,
      url: `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/share/${r.token}`,
      expiresAt: r.expires_at ?? null,
    }, "สร้าง share link สำเร็จ");
  })

  // DELETE /api/tasks/:id/share/:token — revoke (auth required)
  .delete("/api/tasks/:id/share/:token", authMiddleware, async (c) => {
    await db.execute(sql.raw(`
      DELETE FROM share_links WHERE token = '${c.req.param("token").replace(/'/g, "''")}'
    `));
    return ok(c, null, "ยกเลิก share link แล้ว");
  });

// ── Public route (no auth) — read-only task view ──────────────────────────

export const publicShareRouter = new Hono()
  .get("/api/share/:token", async (c) => {
    const token = c.req.param("token");
    const rows = await db.execute<Record<string, unknown>>(sql.raw(`
      SELECT t.title, t.description, t.display_id, t.priority, t.status,
             t.deadline::text AS deadline, t.created_at::text AS created_at,
             t.completed_at IS NOT NULL AS is_done,
             e.name AS assignee, l.name AS list_name, s.name AS space_name,
             sl.expires_at::text AS expires_at
      FROM share_links sl
      JOIN tasks t ON sl.task_id = t.id
      LEFT JOIN employees e ON t.assignee_id = e.id
      LEFT JOIN lists l ON t.list_id = l.id
      LEFT JOIN spaces s ON l.space_id = s.id
      WHERE sl.token = '${token.replace(/'/g, "''")}'
        AND t.deleted_at IS NULL
        AND (sl.expires_at IS NULL OR sl.expires_at > NOW())
      LIMIT 1
    `));
    const r = (((rows as any).rows ?? rows) as any[])[0];
    if (!r) return c.json({ error: "Link not found or expired" }, 404);
    return c.json({ success: true, data: r });
  });
