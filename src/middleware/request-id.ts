import { createMiddleware } from "hono/factory";
import { logger } from "@/lib/logger.ts";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

/**
 * inject X-Request-ID ทุก request
 * - ถ้า client ส่งมา → ใช้ค่านั้น (ทำให้ trace ข้าม service ได้)
 * - ถ้าไม่มี → generate ใหม่
 *
 * ลงทะเบียนใน app.ts ก่อน routes ทั้งหมด:
 *   app.use(requestIdMiddleware)
 */
export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const reqId =
    c.req.header("x-request-id") ??
    crypto.randomUUID();

  c.set("requestId", reqId);
  c.header("X-Request-ID", reqId);

  const start = Date.now();

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  logger.info(
    {
      reqId,
      method:   c.req.method,
      path:     c.req.path,
      status,
      duration: `${duration}ms`,
    },
    `${c.req.method} ${c.req.path} ${status}`
  );
});
