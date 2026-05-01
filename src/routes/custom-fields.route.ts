import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok } from "@/lib/response.ts";
import { customFieldRepository } from "@/repositories/custom-field.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

const createBody = z.object({
  name:         z.string().min(1).max(100),
  fieldType:    z.enum(["text","number","date","select"]),
  options:      z.array(z.string()).optional(),
  required:     z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

const requireManager = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin" && user.role !== "manager") {
    return c.json({ success: false, message: "manager หรือ admin เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

export const customFieldsRouter = new Hono()
  .use(authMiddleware)

  .get("/list/:listId", async (c) => {
    const listId = c.req.param("listId");
    const data = await customFieldRepository.listByList(listId);
    return ok(c, data, "ดึง custom fields สำเร็จ");
  })

  .post("/list/:listId", validate("json", createBody), async (c) => {
    const forbidden = requireManager(c);
    if (forbidden) return forbidden;
    const listId = c.req.param("listId");
    const body = c.req.valid("json" as never) as any;
    const created = await customFieldRepository.create({ ...body, listId });
    return ok(c, created, "เพิ่ม custom field สำเร็จ");
  })

  .delete("/:id", async (c) => {
    const forbidden = requireManager(c);
    if (forbidden) return forbidden;
    const { id } = c.req.param();
    await customFieldRepository.remove(id);
    return ok(c, null, "ลบ custom field สำเร็จ");
  });
