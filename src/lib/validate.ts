import { zValidator } from "@hono/zod-validator";
import type { ZodType, ZodError } from "zod";
import type { ValidationTargets } from "hono";
import type { ErrorResponse } from "@/lib/response.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Field-level error item */
export interface FieldError {
  field: string;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * แปลง ZodError เป็น array of { field, message }
 * รองรับทั้ง nested path (e.g. "address.city") และ top-level
 */
function flattenZodErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "_root",
    message: issue.message,
  }));
}

// ── validate() wrapper ────────────────────────────────────────────────────────

/**
 * Zod validation middleware wrapper
 *
 * ครอบ `@hono/zod-validator` เพื่อให้ทุก route ที่ validation ล้มเหลว
 * ส่งกลับ 400 พร้อม field errors ในรูปแบบมาตรฐานของ project:
 *
 * ```json
 * {
 *   "success": false,
 *   "error": {
 *     "code":    "VALIDATION_ERROR",
 *     "message": "ข้อมูลที่ส่งมาไม่ถูกต้อง",
 *     "details": [
 *       { "field": "email",    "message": "Email ไม่ถูกต้อง" },
 *       { "field": "password", "message": "กรุณากรอกรหัสผ่าน" }
 *     ]
 *   }
 * }
 * ```
 *
 * @param target  - Hono validation target: "json" | "query" | "param" | "form" | "header"
 * @param schema  - Zod schema ที่ใช้ validate
 *
 * @example
 * // body (json)
 * .post("/login", validate("json", loginSchema), async (c) => { ... })
 *
 * @example
 * // query string
 * .get("/tasks", validate("query", listTasksSchema), async (c) => { ... })
 */
export function validate<
  T extends ZodType,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const body: ErrorResponse = {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "ข้อมูลที่ส่งมาไม่ถูกต้อง",
          details: flattenZodErrors(result.error),
        },
      };
      return c.json(body, 400);
    }
    // result.success === true → ปล่อยผ่านไปยัง handler ต่อไป (Hono จัดการเอง)
    return undefined;
  });
}

// ── Shorthand aliases ─────────────────────────────────────────────────────────

/**
 * validate("json", schema)  — สำหรับ request body
 * @example  .post("/", vJson(createTaskSchema), handler)
 */
export const vJson = <T extends ZodType>(schema: T) => validate("json", schema);

/**
 * validate("query", schema)  — สำหรับ query string
 * @example  .get("/", vQuery(listTasksSchema), handler)
 */
export const vQuery = <T extends ZodType>(schema: T) =>
  validate("query", schema);

/**
 * validate("param", schema)  — สำหรับ path params
 * @example  .get("/:id", vParam(z.object({ id: z.string().uuid() })), handler)
 */
export const vParam = <T extends ZodType>(schema: T) =>
  validate("param", schema);
