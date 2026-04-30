import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok } from "@/lib/response.ts";
import { taskTemplateRepository } from "@/repositories/task-template.repository.ts";
import { AppError, ErrorCode } from "@/lib/errors.ts";

const createBody = z.object({
  name:              z.string().min(1).max(120),
  title:             z.string().min(1).max(500),
  description:       z.string().max(5000).optional().nullable(),
  taskTypeId:        z.string().uuid().optional().nullable(),
  priority:          z.enum(["low", "normal", "high", "urgent"]).optional().nullable(),
  timeEstimateHours: z.number().min(0).optional().nullable(),
  storyPoints:       z.number().int().min(0).optional().nullable(),
  tags:              z.array(z.string()).optional(),
});

const requireAuth = (c: any) => {
  const user = c.get("user");
  if (!user) return c.json({ success: false, message: "Unauthorized", error: "UNAUTHORIZED" }, 401);
  return null;
};

export const taskTemplatesRouter = new Hono()
  .use(authMiddleware)

  .get("/", async (c) => {
    const data = await taskTemplateRepository.list();
    return ok(c, data, "ดึง task templates สำเร็จ");
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const data = await taskTemplateRepository.findById(id);
    if (!data) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ template", 404);
    return ok(c, data, "ok");
  })

  .post("/", validate("json", createBody), async (c) => {
    const forbidden = requireAuth(c);
    if (forbidden) return forbidden;
    const user = c.get("user");
    const body = c.req.valid("json" as never) as any;
    const created = await taskTemplateRepository.create({
      ...body,
      createdBy: user.userId,
    });
    return ok(c, created, "สร้าง template สำเร็จ");
  })

  .delete("/:id", async (c) => {
    const forbidden = requireAuth(c);
    if (forbidden) return forbidden;
    const id = c.req.param("id");
    const existing = await taskTemplateRepository.findById(id);
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ template", 404);
    await taskTemplateRepository.remove(id);
    return ok(c, null, "ลบ template สำเร็จ");
  });
