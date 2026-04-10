import { createMiddleware } from "hono/factory";
import { AppError, ErrorCode } from "@/lib/errors.ts";

/**
 * In-memory rate limiter — เหมาะกับ single instance
 * สำหรับ multi-instance ให้เปลี่ยนไปใช้ Redis แทน store
 *
 * Usage:
 *   // auth/login — 10 ครั้งต่อนาทีต่อ IP
 *   app.post('/api/auth/login', rateLimit({ max: 10, windowMs: 60_000 }), handler)
 *
 *   // general API — 100 ครั้งต่อนาทีต่อ IP
 *   app.use('/api/*', rateLimit({ max: 100, windowMs: 60_000 }))
 */

interface RateLimitOptions {
  max:      number; // จำนวน request สูงสุดใน window
  windowMs: number; // ความยาว window (ms)
  keyFn?:   (c: import("hono").Context) => string; // custom key (default: IP)
}

interface Bucket {
  count:     number;
  resetTime: number;
}

// store แยกต่างหากตาม windowMs เพื่อรองรับหลาย rule
const stores = new Map<number, Map<string, Bucket>>();

function getStore(windowMs: number): Map<string, Bucket> {
  if (!stores.has(windowMs)) {
    stores.set(windowMs, new Map());
  }
  return stores.get(windowMs)!;
}

export function rateLimit(opts: RateLimitOptions) {
  const { max, windowMs, keyFn } = opts;
  const store = getStore(windowMs);

  // cleanup expired entries ทุก window (ป้องกัน memory leak)
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      if (now > bucket.resetTime) store.delete(key);
    }
  }, windowMs);

  return createMiddleware(async (c, next) => {
    const key = keyFn
      ? keyFn(c)
      : c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
          ?? c.req.header("x-real-ip")
          ?? "unknown";

    const now = Date.now();
    const bucket = store.get(key);

    if (!bucket || now > bucket.resetTime) {
      // window ใหม่
      store.set(key, { count: 1, resetTime: now + windowMs });
      c.header("X-RateLimit-Limit",     String(max));
      c.header("X-RateLimit-Remaining", String(max - 1));
      c.header("X-RateLimit-Reset",     String(Math.ceil((now + windowMs) / 1000)));
      return next();
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetTime - now) / 1000);
      c.header("Retry-After",           String(retryAfter));
      c.header("X-RateLimit-Limit",     String(max));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset",     String(Math.ceil(bucket.resetTime / 1000)));
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Too many requests — retry after ${retryAfter}s`,
        429 as any
      );
    }

    bucket.count++;
    c.header("X-RateLimit-Limit",     String(max));
    c.header("X-RateLimit-Remaining", String(max - bucket.count));
    c.header("X-RateLimit-Reset",     String(Math.ceil(bucket.resetTime / 1000)));

    return next();
  });
}

// ── Presets ───────────────────────────────────────────────────────────────────

/** เข้มงวดสำหรับ login endpoint: 10 req/min ต่อ IP */
export const authRateLimit = rateLimit({ max: 10, windowMs: 60_000 });

/** ทั่วไป: 100 req/min ต่อ IP */
export const apiRateLimit = rateLimit({ max: 100, windowMs: 60_000 });
