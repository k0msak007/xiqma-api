import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { taskService } from "@/services/task.service.ts";
import { ok } from "@/lib/response.ts";
import { searchQuerySchema } from "@/validators/task.validator.ts";

export const searchRouter = new Hono()
  .use(authMiddleware)

  // GET /search?q=&types=&limit=
  .get("/", validate("query", searchQuerySchema), async (c) => {
    const { q, types, limit } = c.req.valid("query");
    const user                = c.get("user");

    // Parse types: comma-separated string → array, default to all
    const typeList = types
      ? types.split(",").map(t => t.trim()).filter(Boolean)
      : ["task", "employee", "space"];

    const results = await taskService.search(q, typeList, limit ?? 10, user.userId, user.role);
    return ok(c, results, "ค้นหาสำเร็จ");
  });
