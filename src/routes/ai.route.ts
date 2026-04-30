import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "@/middleware/auth.ts";
import { validate } from "@/lib/validate.ts";
import { extractTasksBodySchema } from "@/validators/ai.validator.ts";
import { aiTaskService } from "@/services/ai-task.service.ts";
import { durationEstimator } from "@/services/duration-estimator.service.ts";
import { aiQaService } from "@/services/ai-qa.service.ts";
import { logger } from "@/lib/logger.ts";

// All AI features are admin-only (cost + privacy considerations).
const requireAdmin = (c: any) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ success: false, message: "ฟีเจอร์ AI สำหรับ admin เท่านั้น", error: "FORBIDDEN" }, 403);
  }
  return null;
};

const estimateDurationSchema = z.object({
  title:       z.string().min(1).max(500),
  description: z.string().max(5000).optional().nullable(),
});

const qaBodySchema = z.object({
  question: z.string().min(1).max(1000),
});

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

// POST /ai/estimate-duration — predict task hours from similar past tasks
ai.post(
  "/estimate-duration",
  validate("json", estimateDurationSchema),
  async (c) => {
    const forbidden = requireAdmin(c);
    if (forbidden) return forbidden;
    const body = c.req.valid("json" as never) as {
      title: string; description?: string | null;
    };
    try {
      const result = await durationEstimator.estimate(body);
      return c.json({ success: true, data: result, message: "ประเมินระยะเวลาเสร็จ" });
    } catch (err: any) {
      logger.error({ err }, "estimate-duration failed");
      return c.json({
        success: false,
        message: err?.message ?? "ไม่สามารถประเมินได้ — ลองใหม่",
        data: null,
      }, 500);
    }
  },
);

// POST /ai/qa — natural language Q&A via tool-use (manager+)
ai.post(
  "/qa",
  validate("json", qaBodySchema),
  async (c) => {
    const user = c.get("user");
    // Allow manager and admin
    if (user.role !== "admin" && user.role !== "manager") {
      return c.json({ success: false, message: "ฟีเจอร์นี้สำหรับ manager และ admin", error: "FORBIDDEN" }, 403);
    }
    const body = c.req.valid("json" as never) as { question: string };
    try {
      const result = await aiQaService.ask(body.question, {
        userId: user.userId,
        role: user.role,
        name: user.name ?? "User",
      });
      return c.json({ success: true, data: result, message: "ตอบคำถามเสร็จ" });
    } catch (err: any) {
      logger.error({ err }, "qa failed");
      return c.json({
        success: false,
        message: err?.message ?? "ไม่สามารถตอบคำถามได้ — ลองใหม่",
        data: null,
      }, 500);
    }
  },
);

export const aiRouter = ai;
