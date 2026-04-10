import type { Context } from "hono";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
}

export interface SuccessResponse<T> {
  success: true;
  message: string;
  data:    T;
  meta?:   PaginationMeta;
}

export interface ErrorResponse {
  success: false;
  message: string;       // human-readable — แสดงให้ user เห็น
  error:   string;       // machine-readable code — ให้ client จัดการ logic
  details?: unknown;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

// ── Response helpers ──────────────────────────────────────────────────────────

/**
 * ส่ง success response มาตรฐาน
 *
 * @example
 * return ok(c, { id: '123', name: 'John' })
 * return ok(c, tasks, 'ดึงข้อมูล task สำเร็จ', { page: 1, limit: 20, total: 100, totalPages: 5 })
 */
export function ok<T>(
  c:       Context,
  data:    T,
  message: string        = "success",
  meta?:   PaginationMeta,
  status:  200 | 201     = 200,
) {
  const body: SuccessResponse<T> = {
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  };
  return c.json(body, status);
}

/**
 * ส่ง 201 Created response
 *
 * @example
 * return created(c, newTask, 'สร้าง task สำเร็จ')
 */
export function created<T>(c: Context, data: T, message: string = "created") {
  return ok(c, data, message, undefined, 201);
}

/**
 * ส่ง error response มาตรฐาน
 *
 * @example
 * return fail(c, 'Email นี้ถูกใช้แล้ว', 'EMAIL_EXISTS', 409)
 */
export function fail(
  c:        Context,
  message:  string,
  error:    string,
  status:   400 | 401 | 403 | 404 | 409 | 422 | 500 = 400,
  details?: unknown,
) {
  const body: ErrorResponse = {
    success: false,
    message,
    error,
    ...(details ? { details } : {}),
  };
  return c.json(body, status);
}

/**
 * คำนวณ pagination meta จาก query params
 *
 * @example
 * const { page, limit, offset, buildMeta } = paginate(c)
 * const rows = await db.query({ limit, offset })
 * return ok(c, rows, 'ดึงข้อมูลสำเร็จ', buildMeta(total))
 */
export function paginate(c: Context, defaultLimit = 20) {
  const page   = Math.max(1, Number(c.req.query("page")  ?? 1));
  const limit  = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? defaultLimit)));
  const offset = (page - 1) * limit;

  return {
    page,
    limit,
    offset,
    buildMeta: (total: number): PaginationMeta => ({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }),
  };
}
