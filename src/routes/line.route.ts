import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { ok } from "@/lib/response.ts";
import { lineService } from "@/services/line.service.ts";

// /api/line/* — authenticated user actions for LINE pairing
export const lineRouter = new Hono()
  .use(authMiddleware)

  // GET /line/status — current link state
  .get("/status", async (c) => {
    const user = c.get("user");
    const data = await lineService.getLinkStatus(user.userId);
    return ok(c, data, "ดึงสถานะ LINE สำเร็จ");
  })

  // POST /line/link-token — generate (or reuse) a 6-digit token
  .post("/link-token", async (c) => {
    const user = c.get("user");
    const data = await lineService.createLinkToken(user.userId);
    return ok(c, data, "สร้างรหัสผูกบัญชีสำเร็จ");
  })

  // DELETE /line/link — unlink
  .delete("/link", async (c) => {
    const user = c.get("user");
    await lineService.unlinkAccount(user.userId);
    return ok(c, null, "ยกเลิกการผูกบัญชี LINE สำเร็จ");
  })

  // POST /line/test — send a test message to verify pairing
  .post("/test", async (c) => {
    const user = c.get("user");
    await lineService.sendTestMessage(user.userId);
    return ok(c, null, "ส่งข้อความทดสอบสำเร็จ");
  });
