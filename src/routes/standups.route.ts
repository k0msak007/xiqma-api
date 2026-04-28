import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { ok } from "@/lib/response.ts";
import { standupService } from "@/services/standup.service.ts";

const idParamSchema   = z.object({ id: z.string().uuid() });
const dateQuerySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const updateBody      = z.object({ draftText: z.string().min(1).max(5000) });

const settingsBody = z.object({
  enabled:         z.boolean().optional(),
  sendTime:        z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  sendDays:        z.array(z.number().int().min(1).max(7)).min(1).optional(),
  respectWorkDays: z.boolean().optional(),
});

const requireAdmin = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ success: false, message: "ต้องเป็น admin เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

export const standupsRouter = new Hono()
  .use(authMiddleware)

  // GET /standups/today — my today's standup (auto-generate if missing)
  .get("/today", async (c) => {
    const user = c.get("user");
    const data = await standupService.getOrGenerateMine(user.userId);
    return ok(c, data, "ดึง standup ของวันนี้สำเร็จ");
  })

  // GET /standups/team?date= — team view (admin sees everyone, manager sees direct reports)
  .get("/team", validate("query", dateQuerySchema), async (c) => {
    const user = c.get("user");
    const { date } = c.req.valid("query");
    const today = date ?? new Date().toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }).slice(0, 10);
    const data = await standupService.listForTeam(user.userId, user.role, today);
    return ok(c, data, "ดึง standup ของทีมสำเร็จ");
  })

  // POST /standups/regenerate — force regenerate my today's standup
  .post("/regenerate", async (c) => {
    const user = c.get("user");
    const updated = await standupService.generateForEmployee(user.userId);
    return ok(c, updated, "สร้าง standup ใหม่สำเร็จ");
  })

  // PATCH /standups/:id — edit my draft
  .patch("/:id", validate("param", idParamSchema), validate("json", updateBody), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const { draftText } = c.req.valid("json");
    const updated = await standupService.updateDraft(id, user.userId, draftText);
    return ok(c, updated, "อัปเดต standup สำเร็จ");
  })

  // POST /standups/:id/send — mark as sent + notify manager/admins
  .post("/:id/send", validate("param", idParamSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const updated = await standupService.send(id, user.userId);
    return ok(c, updated, "ส่ง standup สำเร็จ");
  })

  // POST /standups/:id/skip — skip today
  .post("/:id/skip", validate("param", idParamSchema), async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const updated = await standupService.skip(id, user.userId);
    return ok(c, updated, "ข้าม standup สำเร็จ");
  })

  // ── Settings (admin only) ────────────────────────────────────────────────
  // GET /standups/settings
  .get("/settings", async (c) => {
    const data = await standupService.getSettings();
    return ok(c, data, "ดึง standup settings สำเร็จ");
  })

  // PUT /standups/settings
  .put("/settings", validate("json", settingsBody), async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const body = c.req.valid("json");
    const updated = await standupService.updateSettings(body);
    return ok(c, updated, "อัปเดต settings สำเร็จ");
  })

  // POST /standups/run-now — admin only, force generate now (ignores schedule)
  .post("/run-now", async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const result = await standupService.generateForAll({ force: true });
    return ok(c, result, "trigger generate สำเร็จ");
  });
