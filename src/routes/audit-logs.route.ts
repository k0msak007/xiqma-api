import { Hono } from "hono";
import { authMiddleware, requireRole } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok, paginate } from "@/lib/response.ts";
import { auditService } from "@/services/audit.service.ts";
import { listAuditLogsSchema } from "@/validators/profile.validator.ts";

export const auditLogsRouter = new Hono()
  .use(authMiddleware)
  .use(requireRole("admin"))

  // GET /audit-logs?actor_id=&table_name=&action=&from=&to=&page=&limit=
  .get("/", validate("query", listAuditLogsSchema), async (c) => {
    const q = c.req.valid("query");
    const { rows, total } = await auditService.list({
      ...(q.actor_id   !== undefined && { actorId:   q.actor_id }),
      ...(q.table_name !== undefined && { tableName: q.table_name }),
      ...(q.action     !== undefined && { action:    q.action }),
      ...(q.from       !== undefined && { from:      q.from }),
      ...(q.to         !== undefined && { to:        q.to }),
      page:  q.page,
      limit: q.limit,
    });
    const { buildMeta } = paginate(c);
    return ok(c, rows, "ดึงข้อมูล audit log สำเร็จ", buildMeta(total));
  });
