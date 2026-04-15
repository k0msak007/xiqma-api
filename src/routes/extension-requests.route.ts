import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { taskService } from "@/services/task.service.ts";
import { ok } from "@/lib/response.ts";
import { rejectExtensionSchema } from "@/validators/task.validator.ts";

const extensionParamSchema = z.object({ id: z.string().uuid() });
const extensionQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const extensionRequestsRouter = new Hono()
  .use(authMiddleware)

  // GET /extension-requests?status=
  .get("/", validate("query", extensionQuerySchema), async (c) => {
    const { status } = c.req.valid("query");
    const user       = c.get("user");
    const extensions = await taskService.listAllExtensionRequests(status, user.userId, user.role);
    return ok(c, extensions, "ดึงข้อมูล extension requests สำเร็จ");
  })

  // PATCH /extension-requests/:id/approve
  .patch("/:id/approve", validate("param", extensionParamSchema), async (c) => {
    const { id }    = c.req.valid("param");
    const user      = c.get("user");
    const extension = await taskService.approveExtension(id, user.userId, user.role);
    return ok(c, extension, "อนุมัติคำขอขยายเวลาสำเร็จ");
  })

  // PATCH /extension-requests/:id/reject
  .patch("/:id/reject", validate("param", extensionParamSchema), validate("json", rejectExtensionSchema), async (c) => {
    const { id }    = c.req.valid("param");
    const data      = c.req.valid("json");
    const user      = c.get("user");
    const extension = await taskService.rejectExtension(id, user.userId, user.role, data);
    return ok(c, extension, "ปฏิเสธคำขอขยายเวลาสำเร็จ");
  });
