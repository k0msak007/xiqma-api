import { Hono } from "hono";
import { validate } from "@/lib/validate.ts";
import { authMiddleware, requirePermission } from "@/middleware/auth.ts";
import { positionService } from "@/services/position.service.ts";
import { ok, created } from "@/lib/response.ts";
import {
  createPositionSchema,
  updatePositionSchema,
  idParamSchema,
} from "@/validators/position.validator.ts";
import { z } from "zod";

const listPositionsSchema = z.object({
  department: z.string().optional(),
});

export const positionsRouter = new Hono()
  .use(authMiddleware)

  // GET /positions — list all active positions
  .get("/", validate("query", listPositionsSchema), async (c) => {
    const { department } = c.req.valid("query");
    const positions = await positionService.list(department);
    return ok(c, positions, "ดึงข้อมูลตำแหน่งสำเร็จ");
  })

  // GET /positions/:id — get position by id
  .get("/:id", validate("param", idParamSchema), async (c) => {
    const { id } = c.req.valid("param");
    const position = await positionService.findById(id);
    return ok(c, position, "ดึงข้อมูลตำแหน่งสำเร็จ");
  })

  // POST /positions — create position
  .post(
    "/",
    requirePermission("manage_workspace"),
    validate("json", createPositionSchema),
    async (c) => {
      const data = c.req.valid("json");
      const position = await positionService.create(data);
      return created(c, position, "สร้างตำแหน่งสำเร็จ");
    }
  )

  // PUT /positions/:id — update position
  .put(
    "/:id",
    requirePermission("manage_workspace"),
    validate("param", idParamSchema),
    validate("json", updatePositionSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const data = c.req.valid("json");
      const position = await positionService.update(id, data);
      return ok(c, position, "แก้ไขตำแหน่งสำเร็จ");
    }
  )

  // DELETE /positions/:id — soft delete position
  .delete(
    "/:id",
    requirePermission("manage_workspace"),
    validate("param", idParamSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      await positionService.delete(id);
      return ok(c, null, "ลบตำแหน่งสำเร็จ");
    }
  );
