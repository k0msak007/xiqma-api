// ── Error codes ───────────────────────────────────────────────────────────────

export const ErrorCode = {
  // Auth
  INVALID_CREDENTIALS:    "INVALID_CREDENTIALS",
  TOKEN_EXPIRED:          "TOKEN_EXPIRED",
  INVALID_TOKEN:          "INVALID_TOKEN",
  MISSING_TOKEN:          "MISSING_TOKEN",
  FORBIDDEN:              "FORBIDDEN",
  WRONG_PASSWORD:         "WRONG_PASSWORD",

  // Resource
  NOT_FOUND:              "NOT_FOUND",
  ALREADY_EXISTS:         "ALREADY_EXISTS",

  // Business logic
  EMAIL_EXISTS:           "EMAIL_EXISTS",
  ROLE_NAME_EXISTS:       "ROLE_NAME_EXISTS",
  ROLE_IN_USE:            "ROLE_IN_USE",
  TASK_TYPE_IN_USE:       "TASK_TYPE_IN_USE",
  STATUS_IN_USE:          "STATUS_IN_USE",
  SESSION_ALREADY_RUNNING:"SESSION_ALREADY_RUNNING",
  QUOTA_EXCEEDED:         "QUOTA_EXCEEDED",
  ALREADY_CHECKED_IN:     "ALREADY_CHECKED_IN",
  ALREADY_CHECKED_OUT:    "ALREADY_CHECKED_OUT",
  PENDING_REQUEST_EXISTS: "PENDING_REQUEST_EXISTS",
  INVALID_DATE_RANGE:     "INVALID_DATE_RANGE",
  POSITION_IN_USE:        "POSITION_IN_USE",
  WORK_SCHEDULE_IN_USE:   "WORK_SCHEDULE_IN_USE",
  EMPLOYEE_CODE_EXISTS:   "EMPLOYEE_CODE_EXISTS",
  HOLIDAY_DATE_EXISTS:    "HOLIDAY_DATE_EXISTS",

  // Validation
  VALIDATION_ERROR:       "VALIDATION_ERROR",
  UPLOAD_FAILED:         "UPLOAD_FAILED",

  // Server
  INTERNAL_ERROR:         "INTERNAL_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── AppError class ────────────────────────────────────────────────────────────

/**
 * Custom error ที่ error middleware จะจับแล้วส่งเป็น JSON response มาตรฐาน
 *
 * @example
 * throw new AppError(ErrorCode.EMAIL_EXISTS, "Email นี้ถูกใช้แล้ว", 409)
 * throw new AppError(ErrorCode.NOT_FOUND, "ไม่พบ task นี้", 404)
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCodeType,
    message: string,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}
