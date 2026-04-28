import { Hono } from "hono";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { extractTasksBodySchema } from "@/validators/ai.validator.ts";
import { aiTaskService } from "@/services/ai-task.service.ts";

// All AI features are admin-only (cost + privacy considerations).
const requireAdmin = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ success: false, message: "ฟีเจอร์ AI สำหรับ admin เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

const ai = new Hono().use(authMiddleware);

// POST /ai/tasks/extract — extract task drafts from free-form text
ai.post(
  "/tasks/extract",
  validate("json", extractTasksBodySchema),
  async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const body = c.req.valid("json" as never) as {
      text: string; listId: string; language: "th" | "en";
    };
    const result = await aiTaskService.extractTasks(body);
    return c.json({
      success: true,
      data:    result,
      message: `สกัด ${result.drafts.length} task สำเร็จ`,
    });
  },
);

export const aiRouter = ai;
