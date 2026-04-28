import { Hono } from "hono";
import { verifySignature } from "@/lib/line.ts";
import { lineService } from "@/services/line.service.ts";
import { logger } from "@/lib/logger.ts";

// /api/webhooks/line — public endpoint, signed by LINE
//
// IMPORTANT: this router is PUBLIC (no auth middleware). LINE platform calls it
// with X-Line-Signature header. We verify HMAC-SHA256 against channel secret.
export const lineWebhookRouter = new Hono()
  .post("/", async (c) => {
    const sigHeader = c.req.header("x-line-signature") ?? c.req.header("X-Line-Signature");
    const rawBody   = await c.req.text();

    // Verify signature — reject if invalid
    if (!verifySignature(rawBody, sigHeader ?? null)) {
      logger.warn({ sig: sigHeader }, "line webhook: invalid signature");
      return c.json({ success: false, error: "INVALID_SIGNATURE" }, 401);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ success: false, error: "INVALID_JSON" }, 400);
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    // Process events sequentially (each is small, order matters for follow→message flow)
    for (const ev of events) {
      try {
        await lineService.handleWebhookEvent(ev);
      } catch (err) {
        logger.error({ err, eventType: ev?.type }, "line webhook: handler failed");
      }
    }

    // LINE expects 200 OK quickly
    return c.json({ success: true });
  });
