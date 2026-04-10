import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { AppError, ErrorCode } from "@/lib/errors.ts";
import { logError } from "@/lib/logger.ts";

/**
 * Global error handler — ลงทะเบียนใน app.onError()
 * จับ AppError, ZodError, HTTPException และ error อื่นๆ ทั้งหมด
 * แล้วส่งเป็น JSON response มาตรฐาน:
 *   { success: false, message: "human readable", error: "MACHINE_CODE" }
 */
export function errorMiddleware(err: unknown, c: Context) {
  const reqId = c.get("requestId");

  // 1. AppError — business logic errors ที่เราโยนเอง
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logError(err, "AppError 5xx", { reqId, code: err.code });
    }
    return c.json(
      {
        success: false,
        message: err.message,
        error:   err.code,
        ...(err.details ? { details: err.details } : {}),
      },
      err.status
    );
  }

  // 2. ZodError — validation errors จาก @hono/zod-validator
  if (err instanceof ZodError) {
    return c.json(
      {
        success: false,
        message: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบ fields ที่ส่งมา",
        error:   ErrorCode.VALIDATION_ERROR,
        details: err.errors.map((e) => ({
          field:   e.path.join("."),
          message: e.message,
        })),
      },
      422
    );
  }

  // 3. Hono HTTPException — เช่น 404 จาก route ที่ไม่มี
  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        message: err.message,
        error:   `HTTP_${err.status}`,
      },
      err.status
    );
  }

  // 4. Unknown errors — log แล้วส่ง 500
  logError(err, "Unhandled error", { reqId, path: c.req.path });

  return c.json(
    {
      success: false,
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error:   ErrorCode.INTERNAL_ERROR,
    },
    500
  );
}
