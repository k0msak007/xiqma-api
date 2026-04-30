import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok } from "@/lib/response.ts";
import { savedFilterRepository } from "@/repositories/saved-filter.repository.ts";

const createBody = z.object({
  name:   z.string().min(1).max(100),
  listId: z.string().uuid(),
  config: z.record(z.any()),
});

export const savedFiltersRouter = new Hono()
  .use(authMiddleware)

  .get("/", async (c) => {
    const user = c.get("user");
    const listId = c.req.query("listId");
    if (!listId) return c.json({ success: false, message: "listId required" }, 400);
    const data = await savedFilterRepository.listByUser(user.userId, listId);
    return ok(c, data, "ok");
  })

  .post("/", validate("json", createBody), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json" as never) as any;
    const created = await savedFilterRepository.create({
      ...body,
      userId: user.userId,
    });
    return ok(c, created, "บันทึก filter แล้ว");
  })

  .delete("/:id", async (c) => {
    const user = c.get("user");
    const { id } = c.req.param();
    await savedFilterRepository.remove(id, user.userId);
    return ok(c, null, "ลบ filter แล้ว");
  });
